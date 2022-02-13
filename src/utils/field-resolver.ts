import * as graphql from "graphql";
import { isObjectLike } from "lodash";

export const FieldResolver: graphql.GraphQLFieldResolver<unknown, unknown> =
  function (source: any, args, context, info) {
    if (isObjectLike(source) || typeof source === "function") {
      const property = source[info.fieldName];
      if (typeof property === "function") {
        return source[info.fieldName]({ source, args, context, info });
      }
      return property;
    }
  };
