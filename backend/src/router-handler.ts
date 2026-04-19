import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { headers as defaultHeaders } from "./utils/error-handler.js";
import { login } from "./functions/auth/login.js";
import { forgotPassword } from "./functions/auth/forgot-password.js";
import { resetPassword } from "./functions/auth/reset-password.js";
import { createUserInvitation } from "./functions/user/create-user.js";
import { acceptUserInvitation } from "./functions/user/accept-invite.js";
import { assignSystemAccess } from "./functions/user/assign-system-access.js";
import { listUsers } from "./functions/user/list-users.js";
import { getUser } from "./functions/user/get-user.js";
import { deleteUser } from "./functions/user/delete-user.js";
import { listSystems } from "./functions/health/list-systems.js";
import { createHealthCheck } from "./functions/health/check-health.js";
import { deleteSystem } from "./functions/health/delete-system.js";
import { triggerHealthCheck } from "./functions/health/trigger-health.js";
import { getSystemLogs } from "./functions/health/get-system-logs.js";

type LegacyHandler = (
  event: APIGatewayProxyEvent,
) => Promise<APIGatewayProxyResult>;

interface Route {
  method: string;
  path: string;
  handler: LegacyHandler;
}

const routes: Route[] = [
  { method: "POST", path: "/auth/login", handler: login },
  { method: "POST", path: "/auth/forgot-password", handler: forgotPassword },
  { method: "POST", path: "/auth/reset-password", handler: resetPassword },
  { method: "POST", path: "/users/invite", handler: createUserInvitation },
  {
    method: "POST",
    path: "/users/invite/accept",
    handler: acceptUserInvitation,
  },
  { method: "POST", path: "/users/:id/systems", handler: assignSystemAccess },
  { method: "GET", path: "/users", handler: listUsers },
  { method: "GET", path: "/users/:id", handler: getUser },
  { method: "DELETE", path: "/users/:id", handler: deleteUser },
  { method: "GET", path: "/systems", handler: listSystems },
  { method: "POST", path: "/systems", handler: createHealthCheck },
  { method: "DELETE", path: "/systems/:id", handler: deleteSystem },
  { method: "POST", path: "/systems/:id/trigger", handler: triggerHealthCheck },
  { method: "GET", path: "/systems/:id/logs", handler: getSystemLogs },
];

const splitPath = (path: string): string[] =>
  path.replace(/^\/+/g, "").replace(/\/+$/g, "").split("/").filter(Boolean);

const matchRoute = (
  method: string,
  path: string,
): { route: Route; pathParameters: Record<string, string> } | null => {
  const requestParts = splitPath(path);

  for (const route of routes) {
    if (route.method !== method.toUpperCase()) {
      continue;
    }

    const routeParts = splitPath(route.path);
    if (routeParts.length !== requestParts.length) {
      continue;
    }

    const pathParameters: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < routeParts.length; i += 1) {
      const routePart = routeParts[i];
      const requestPart = requestParts[i];

      if (routePart.startsWith(":")) {
        pathParameters[routePart.slice(1)] = decodeURIComponent(requestPart);
        continue;
      }

      if (routePart !== requestPart) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return { route, pathParameters };
    }
  }

  return null;
};

const toLegacyEvent = (
  event: APIGatewayProxyEventV2,
  pathParameters: Record<string, string>,
): APIGatewayProxyEvent => {
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.headers || {})) {
    if (typeof value === "string") {
      normalizedHeaders[key] = value;
    }
  }

  const rawBody = event.body || null;
  const body =
    event.isBase64Encoded && rawBody
      ? Buffer.from(rawBody, "base64").toString("utf8")
      : rawBody;

  return {
    body,
    headers: normalizedHeaders,
    multiValueHeaders: null,
    httpMethod: event.requestContext.http.method,
    isBase64Encoded: false,
    path: event.rawPath,
    pathParameters,
    queryStringParameters: event.queryStringParameters || null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: event.rawPath,
    requestContext: {
      accountId: event.requestContext.accountId,
      apiId: event.requestContext.apiId,
      authorizer: undefined,
      protocol: event.requestContext.http.protocol,
      httpMethod: event.requestContext.http.method,
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: event.requestContext.http.sourceIp,
        user: null,
        userAgent: event.requestContext.http.userAgent || null,
        userArn: null,
        clientCert: null,
      },
      path: event.rawPath,
      stage: event.requestContext.stage || "$default",
      requestId: event.requestContext.requestId,
      requestTimeEpoch: event.requestContext.timeEpoch,
      resourceId: event.requestContext.requestId,
      resourcePath: event.rawPath,
    },
  } as unknown as APIGatewayProxyEvent;
};

export const api = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  if (event.requestContext.http.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: defaultHeaders,
      body: "",
    };
  }

  const matched = matchRoute(event.requestContext.http.method, event.rawPath);

  if (!matched) {
    return {
      statusCode: 404,
      headers: defaultHeaders,
      body: JSON.stringify({ message: "Route not found" }),
    };
  }

  const legacyEvent = toLegacyEvent(event, matched.pathParameters);
  const response = await matched.route.handler(legacyEvent);

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body,
    isBase64Encoded: response.isBase64Encoded,
  };
};
