import mongoose from "mongoose";
import HistoryItemClass from "./HistoryItemClass";

interface Options {
  connection?: mongoose.Connection,
  collectionName?: String,
  modelName?: String,
  metas?: any,
  filter?: Function,
  handleSave?: Function,
  saveNoDiffs?: Boolean
}

const diffsSchema = new mongoose.Schema({
  kind: String,
  path: String,
  from: {
    type: mongoose.Schema.Types.Mixed,
  },
  to: {
    type: mongoose.Schema.Types.Mixed
  }
}, { _id: false });

const defaultOptions = {
  saveNoDiffs: false,
};

function mongooseVersioning(schema: mongoose.Schema, options: Options = {}) {
  options = Object.assign({}, defaultOptions, options);

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
      diffs: [diffsSchema]
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
      document.__wasNew = false;
      // @ts-ignore
      const doc = document._doc;
      // @ts-ignore
      const HistoryItem = getHistoryModel(document.constructor.collection.name, document.constructor.modelName);
      const historyItem = HistoryItem.create(undefined, doc, doc);
      await historyItem.assignMetas(options.metas);
      historyItem.filterDiffs(options.filter);
      if (typeof options.handleSave === "function") {
        await options.handleSave(historyItem);
      } else if (historyItem.diffs.length || options.saveNoDiffs) {
        await historyItem.save();
      }
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
        const ids = query._updatingRows.map(({ id }) => id);
        query.__updatedRows = await query.model.where({ _id: { $in: ids } }).find();

        await Promise.all(query.__updatingRows.map(async row => {
          const updatedRow = query.__updatedRows.find(({ id }) => id === row.id);
          if (!updatedRow) {
            return;
          }

          const HistoryItem = getHistoryModel(query.model.collection.name, query.model.modelName);
          HistoryItem.create(row, updatedRow, query);
          const historyItem = HistoryItem.create(row, updatedRow, query);
          await historyItem.assignMetas(options.metas);
          historyItem.filterDiffs(options.filter);
          if (typeof options.handleSave === "function") {
            await options.handleSave(historyItem);
          } else if (historyItem.diffs.length || options.saveNoDiffs) {
            await historyItem.save();
          }
        }));

        resolve(true);
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
        const ids = query.__deletingRows.map(({ id }) => id);
        const postDeleteQuery = await query.model.where({ _id: { $in: ids } }).select("_id").lean().find();
        query.__deletedRows = query.__deletingRows.filter(({ id }) => !postDeleteQuery.find(row => row.id === id));

        await Promise.all(query.__deletedRows.map(async row => {
          const HistoryItem = getHistoryModel(query.model.collection.name, query.model.modelName);
          const historyItem = HistoryItem.create(row, undefined, query);
          await historyItem.assignMetas(options.metas);
          historyItem.filterDiffs(options.filter);
          if (typeof options.handleSave === "function") {
            await options.handleSave(historyItem);
          } else if (historyItem.diffs.length || options.saveNoDiffs) {
            await historyItem.save();
          }
        }));

        resolve(true);
      } catch (e) {
        console.log(e);
        reject(e);
      }
    });
  };

  const preRemove = async function () {
  };

  const postRemove = async function () {
    // @ts-ignore
    const document = this as mongoose.Document;
    // @ts-ignore
    const doc = document._doc;
    // @ts-ignore
    const HistoryItem = getHistoryModel(document.constructor.collection.name, document.constructor.modelName);
    const historyItem = HistoryItem.create(doc, undefined, doc);
    await historyItem.assignMetas(options.metas);
    historyItem.filterDiffs(options.filter);
    if (typeof options.handleSave === "function") {
      await options.handleSave(historyItem);
    } else {
      await historyItem.save();
    }
  };

  schema.statics.getHistoryModel = function () {
    return getHistoryModel(this.collection.name, this.modelName);
  };

  schema.statics.addHistoryVirtual = function () {
    // @ts-ignore
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

  schema.pre('remove', preRemove);
  schema.post('remove', postRemove);

  schema.pre('deleteOne', preDelete);
  schema.post('deleteOne', postDelete);

  schema.pre('deleteMany', preDelete);
  schema.post('deleteMany', postDelete);
}

export default mongooseVersioning;