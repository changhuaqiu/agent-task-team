export function mockReq(method: string, body?: any, query?: any): any {
  return { method, body: body ?? {}, query: query ?? {} };
}

export function mockRes(): any {
  const res: any = {
    statusCode: 200,
    _body: null,
    _json: null,
    status(code: number) { res.statusCode = code; return res; },
    json(data: any) { res._json = data; return res; },
    end(data?: string) { res._body = data; return res; },
    setHeader() { return res; },
  };
  return res;
}
