import * as graphql from "graphql";
import { isObjectLike } from "lodash";

export const FieldResolver: graphql.GraphQLFieldResolver<unknown, unknown> =
  function (source: any, args, context: any, info) {
    if (isObjectLike(source) || typeof source === "function") {
      const entityResolverName = `resolve${(info.returnType as any).name}`;
      const property = source?.[info.fieldName];
      const entityResolver = context?.entityResolver?.[entityResolverName];

      if (typeof property === "function") {
        return source[info.fieldName](source, args, context, info);
      }
      if (typeof entityResolver === "function") {
        return context.entityResolver[entityResolverName](
          source,
          args,
          context,
          info
        );
      }
      return property;
    }
  };
