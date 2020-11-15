import mongoose from "mongoose";
import _ from "lodash/object";
import isEqual from "fast-deep-equal";

interface IOptions {
  connection?: mongoose.Connection,
  collectionName?: String,
  modelName?: String,
  metas?: any,
  filter?: Function
}

const getDiffPaths = (object, base, path = []) => {
  let keys = object ? Object.keys(object) : [];
  try {
    keys = keys.concat(Object.keys(base).filter(key => !keys.includes(key)));
  } catch (e) {}
  return keys.reduce((result, key) => {
    const to = object && object[key] && mongoose.Types.ObjectId.isValid(object[key]) ? object[key].toString() : object && object[key];
    const from = base && base[key] && mongoose.Types.ObjectId.isValid(base[key]) ? base[key].toString() : base && base[key];

    if ((to && typeof to === "object" && Object.keys(to).length && !Array.isArray(to)) || (from && typeof from === "object" && Object.keys(from).length) && !Array.isArray(from)) {
      return result.concat(getDiffPaths(to, from, path.concat(key)));
    } else {
      return (to && to.toString()) == (from && from.toString()) ? result : result.concat([path.concat(key)]);
    }
  }, []);
};

const getDiffs = (object, base = {}) => {
  const paths = getDiffPaths(object, base);
  return paths.reduce((diffs, path) => {
    const from = base && _.get(base, path);
    const to = object && _.get(object, path);
    if (!isEqual(from, to)) {
      return diffs.concat({ path: path.join("."), from, to });
    }

    return diffs;
  }, []);
};

function mongooseVersioning(schema: mongoose.Schema, options: IOptions = {}) {
  class HistoryItemClass {
    __original;
    __updated;
    __context;

    document;
    kind;
    date;
    metas;
    diffs;

    static create(original, updated, context?) {
      const item = new this();

      item.__original = original;
      item.__updated = updated;
      item.__context = context;

      if (item.__original && item.__updated && item.__original.id !== item.__updated.id) {
        throw new Error();
      }

      item.document = (item.__original && item.__original.id) || (item.__updated && item.__updated.id);
      item.date = new Date();

      if (item.__original === undefined) {
        item.kind = "create";
        const diffs = getDiffs(item.__updated && item.__updated.toJSON());
        Object.assign(item, { diffs });
      } else if (item.__updated === undefined) {
        item.kind = "delete";
      } else {
        item.kind = "update";
        const diffs = getDiffs(item.__updated && item.__updated.toJSON(), item.__original && item.__original.toJSON());
        Object.assign(item, { diffs });
      }

      return item;
    }

    async assignMetas(metas) {
      if (!metas) {
        return;
      }

      await Promise.all(Object.keys(metas).map(async key => {
        const value = metas[key];
        if (typeof value === "function") {
          metas[key] = await value(this.__original, this.__updated, this.__context);
        }
      }));

      this.metas = this.metas || {};
      Object.assign(this.metas, metas);
    }

    filterDiffs(filterFn) {
      if (!filterFn) {
        return;
      }

      this.diffs = this.diffs && this.diffs.filter(filterFn);
    }
  }

  const getCollectionName = function (_collectionName?) {
    return options.collectionName || (_collectionName && `${ _collectionName }_history`);
  };

  const getModelName = function (_modelName?) {
    return options.modelName || _modelName;
  };

  const getHistoryModel = function (_collectionName?, _modelName?) {
    const collectionName = getCollectionName(_collectionName);
    const modelName = getModelName(_modelName);

    const HistoryItemSchema = new mongoose.Schema({
      document: modelName ? {
        type: mongoose.Schema.Types.ObjectId,
        ref: modelName
      } : String,
      kind: String,
      date: Date,
      metas: mongoose.Schema.Types.Mixed,
      diffs: [{
        kind: String,
        path: String,
        from: {
          type: mongoose.Schema.Types.Mixed,
        },
        to: {
          type: mongoose.Schema.Types.Mixed
        }
      }]
    }, { versionKey: false });
    HistoryItemSchema.loadClass(HistoryItemClass);

    const connection: any = options.connection || mongoose;
    return connection.model(collectionName, HistoryItemSchema, collectionName)
  };

  const preSave = async function () {
    // @ts-ignore
    const document = this as mongoose.Document;
    if (document.isNew) {
      // @ts-ignore
      document.__wasNew = document.isNew;
    }
  };

  const postSave = async function () {
    // @ts-ignore
    const document = this as mongoose.Document;
    // @ts-ignore
    if (document.__wasNew) {
      // @ts-ignore
      const HistoryItem = getHistoryModel(document.constructor.collection.name, document.constructor.modelName);
      const historyItem = HistoryItem.create(undefined, document, document);
      historyItem.filterDiffs(options.filter);
      await historyItem.assignMetas(options.metas);
      await historyItem.save();
    }
  };

  const preUpdate = async function () {
    // @ts-ignore
    const query = this as mongoose.Query;

    try {
      const queryUpdating = new (query.toConstructor())();
      queryUpdating.setUpdate({});
      query.__updatingRows = await queryUpdating.find();
    } catch (e) {
      query.__updatingRows = [];
    }
  };

  const postUpdate = async function () {
    // @ts-ignore
    const query = this as mongoose.Query;
    new Promise(async (resolve, reject) => {
      try {
        const queryUpdated = new (query.toConstructor())();
        queryUpdated.setUpdate({});
        query.__updatedRows = await queryUpdated.find();

        await Promise.all(query.__updatingRows.map(async row => {
          const updatedRow = query.__updatedRows.find(({ id }) => id === row.id);
          if (!updatedRow) {
            return;
          }

          const HistoryItem = getHistoryModel(query.model.collection.name, query.model.modelName);
          HistoryItem.create(row, updatedRow, query);
          const historyItem = HistoryItem.create(row, updatedRow, query);
          historyItem.assignMetas(options.metas);
          historyItem.filterDiffs(options.filter);
          await historyItem.save();
        }));

        resolve();
      } catch (e) {
        reject(e);
      }
    });
  };

  const preDelete = async function () {
    // @ts-ignore
    const query = this as mongoose.Query;

    try {
      const queryDeleting = new (query.toConstructor())();
      queryDeleting.setUpdate({});
      query.__deletingRows = await queryDeleting.find();
    } catch (e) {
      query.__deletingRows = [];
    }
  };

  const postDelete = async function () {
    // @ts-ignore
    const query = this as mongoose.Query;
    new Promise(async (resolve, reject) => {
      try {
        const queryDeleted = new (query.toConstructor())();
        queryDeleted.setUpdate({});
        query.__deletedRows = await queryDeleted.find();

        await Promise.all(query.__deletingRows.map(async row => {
          const deletedRow = query.__deletedRows.find(({ id }) => id === row.id);
          if (deletedRow) {
            return;
          }

          const HistoryItem = getHistoryModel(query.model.collection.name, query.model.modelName);
          const historyItem = HistoryItem.create(row, undefined, query);
          historyItem.assignMetas(options.metas);
          historyItem.filterDiffs(options.filter);
          await historyItem.save();
        }));

        resolve();
      } catch (e) {
        reject(e);
      }
    });
  };

  schema.statics.getHistoryModel = function () {
    return getHistoryModel(this.collection.name, this.modelName);
  };

  schema.statics.addHistoryVirtual = function () {
    const HistoryModel = this.getHistoryModel();
    this.schema.virtual("__history", {
      ref: HistoryModel.modelName,
      localField: '_id',
      foreignField: 'document'
    });
  };

  schema.pre('save', preSave);
  schema.post('save', postSave);

  schema.pre('update', preUpdate);
  schema.post('update', postUpdate);

  schema.pre('updateOne', preUpdate);
  schema.post('updateOne', postUpdate);

  schema.pre('updateMany', preUpdate);
  schema.post('updateMany', postUpdate);

  schema.pre('deleteOne', preDelete);
  schema.post('deleteOne', postDelete);

  schema.pre('deleteMany', preDelete);
  schema.post('deleteMany', postDelete);
}

export default mongooseVersioning;