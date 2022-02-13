import { existsSync, readFileSync } from "fs";
import path from "path";

export const PACKAGE_INFO: { [key: string]: any } = (() => {
  try {
    const packagePath = path.join(__dirname, "../../package.json");
    const isExist = existsSync(packagePath);
    const file = (() => {
      if (isExist) {
        return readFileSync(packagePath, { encoding: "utf-8" });
      }
      return "{}";
    })();

    const parsed = JSON.parse(file);
    return parsed;
  } catch (err) {
    return {};
  }
})();
