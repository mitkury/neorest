import { MatchFunction } from './utils/pathToRegexp';
import { ConnectionSecret, RouteVerb, Payload } from '@neorest/core';
import { ServerConnection } from './ServerConnection';

/**
 * Route subscription ID
 */
export type RouteSubID = number;

/**
 * A listener for a route
 */
export type RouteListener = {
  conn: ConnectionSecret;
  params: string[];
};

/**
 * A verb and handler pair
 */
export type VerbAndHandler = {
  verb: RouteVerb;
  handler: RouteHandler;
};

/**
 * A route handler function
 */
export type RouteHandler = (ctx: RequestContext) => void | Promise<void>;

/**
 * An incoming route layer
 */
export type InRouteLayer = {
  id: RouteSubID;
  route: string;
  regexp: RegExp;
  match: MatchFunction;
  keys: string[];
  verbs: VerbAndHandler[];
};

/**
 * An outgoing route layer
 */
export type OutRouteLayer = {
  id: RouteSubID;
  route: string;
  regexp: RegExp;
  match: MatchFunction;
  keys: string[];
  listeners: RouteListener[];
  validate: (
    conn: ServerConnection,
    params: Record<string, string>,
  ) => boolean | Promise<boolean>;
};

/**
 * Request context for route handlers
 */
export interface RequestContext {
  params: Record<string, string>;
  sender: ServerConnection;
  data: Payload;
  headers: Record<string, string>;
  error?: string;
  response: Payload;
  route: string;
}