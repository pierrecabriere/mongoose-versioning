import {getDiffs} from "./utils";

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

        const u = item.__updated?._doc || item.__updated;
        const o = item.__original?._doc || item.__original;
        if (o === undefined) {
            item.kind = "create";
            const diffs = getDiffs(u);
            Object.assign(item, { diffs });
        } else if (u === undefined) {
            item.kind = "delete";
            const o = item.__original?._doc || item.__original;
            const diffs = getDiffs(undefined, o);
            Object.assign(item, { diffs });
        } else {
            item.kind = "update";
            const diffs = getDiffs(u, o);
            Object.assign(item, { diffs });
        }

        return item;
    }

    async assignMetas(metas) {
        if ("function" === typeof metas) {
            metas = await metas.apply(this, [this.__original, this.__updated, this.__context]);
        }

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

export default HistoryItemClass;