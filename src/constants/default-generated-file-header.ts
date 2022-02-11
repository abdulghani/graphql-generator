import fs from "fs";
import path from "path";

const DEFAULT_GENERATED_FILE_HEADER = fs.readFileSync(
  path.resolve("./default-generated-file-header-text.ts"),
  { encoding: "utf-8" }
);

export default DEFAULT_GENERATED_FILE_HEADER;
