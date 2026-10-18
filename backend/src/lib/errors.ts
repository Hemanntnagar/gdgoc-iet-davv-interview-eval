export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new HttpError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Authentication required') =>
  new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Not permitted') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'Not found') => new HttpError(404, 'not_found', msg);
export const conflict = (msg: string, code = 'conflict', details?: unknown) =>
  new HttpError(409, code, msg, details);
export const tooMany = (msg: string) => new HttpError(429, 'rate_limited', msg);
