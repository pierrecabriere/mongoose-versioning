import isEqual from "fast-deep-equal";
import _ from "lodash/object";

export const serialize = (input) => {
  return input && typeof input === "object" ? JSON.parse(JSON.stringify(input)) : input;
};

export const getDiffPaths = (object, base, path = []) => {
  const objectKeys = object ? Object.keys(object) : [];
  const baseKeys = base ? Object.keys(base) : [];
  const keys = objectKeys.concat(baseKeys.filter((k) => !objectKeys.includes(k)));

  const set = keys.reduce((resultSet, key) => {
    const from = base && _.get(base, key);
    const to = object && _.get(object, key);

    const currentPath = path.concat(key);

    if ((from && typeof from === "object" && Object.keys(from).length && !Array.isArray(from)) || (to && typeof to === "object" && Object.keys(to).length && !Array.isArray(to))) {
      const diffPaths = getDiffPaths(to, from, currentPath);
      diffPaths.forEach((d) => resultSet.add(d));
    } else if (!isEqual(from, to)) {
      resultSet.add(currentPath);
    }

    return resultSet;
  }, new Set([]));

  return [...set];
};

export const getDiffs = (object, base = {}) => {
  let paths = [];
  try {
    paths = getDiffPaths(serialize(object), serialize(base));
  } catch (e) {
    console.log(e);
  }
  return paths.reduce((diffs, path) => {
    const from = base && _.get(base, path);
    const to = object && _.get(object, path);
    return diffs.concat({ path: path.join("."), from, to });
  }, []);
};
