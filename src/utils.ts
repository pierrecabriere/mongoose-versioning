import mongoose from "mongoose";
import isEqual from "fast-deep-equal";
import _ from "lodash/object";

export const getDiffPaths = (object, base, path = []) => {
    let keys = object ? Object.keys(object) : [];
    try {
        keys = keys.concat(Object.keys(base).filter(key => !keys.includes(key)));
    } catch (e) {}
    return keys.reduce((result, key) => {
        const to = object && _.get(object, key) && mongoose.Types.ObjectId.isValid(object[key]) ? _.get(object, key).toString() : object && _.get(object, key);
        const from = base && _.get(base, key) && mongoose.Types.ObjectId.isValid(base[key]) ? _.get(base, key).toString() : base && _.get(base, key);

        if ((to && typeof to === "object" && Object.keys(to).length && !Array.isArray(to)) || (from && typeof from === "object" && Object.keys(from).length) && !Array.isArray(from)) {
            return result.concat(getDiffPaths(to, from, path.concat(key)));
        } else {
            return isEqual(from, to) ? result : result.concat([path.concat(key)]);
        }
    }, []);
};

export const getDiffs = (object, base = {}) => {
    const paths = getDiffPaths(object, base);
    return paths.reduce((diffs, path) => {
        const from = base && _.get(base, path);
        const to = object && _.get(object, path);
        return diffs.concat({ path: path.join("."), from, to });
    }, []);
};