import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export class ServiceError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export function unwrapResponse(result) {
  if (result.isError) throw new ServiceError('麦当劳服务未能完成请求，请稍后重试。');
  let envelope = result.structuredContent;
  if (!envelope) {
    for (const block of result.content ?? []) {
      if (block.type !== 'text') continue;
      const text = block.text;
      // Some tools embed JSON in explanatory Markdown. Read the JSON object only.
      for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
        let depth = 0, quoted = false, escaped = false;
        for (let end = start; end < text.length; end++) {
          const char = text[end];
          if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
          } else if (char === '"') quoted = true;
          else if (char === '{') depth++;
          else if (char === '}' && --depth === 0) {
            try {
              const value = JSON.parse(text.slice(start, end + 1));
              if (Object.hasOwn(value, 'data') || Object.hasOwn(value, 'success')) envelope = value;
            } catch { /* Explanatory text is not API data. */ }
            break;
          }
        }
        if (envelope) break;
      }
      if (envelope) break;
    }
  }
  if (!envelope) throw new ServiceError('麦当劳返回了无法识别的数据格式。');
  if (envelope.success === false || (envelope.code && ![0, 200].includes(envelope.code))) {
    throw new ServiceError(typeof envelope.message === 'string' ? envelope.message : '麦当劳服务暂不可用。');
  }
  return envelope.data;
}

export function safeError(error, token = '') {
  let message = error.message ?? '请求失败';
  if (token) message = message.replaceAll(token, '[已隐藏]');
  message = message.replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]');
  if ([401, 403].includes(error.code) || /401|403|unauthorized|forbidden|鉴权码不存在|鉴权码.*失效/i.test(message)) return '麦当劳 token 无效、已过期或没有权限，请重新获取并连接。';
  if (error.code === 429 || /429/i.test(message)) return '麦当劳接口正在限流，请稍后再试。';
  if (/fetch failed|timeout|timed out|ENOTFOUND|ECONN/i.test(message)) return '网络连接失败，请检查网络后重试。';
  if (error instanceof ServiceError) return message;
  return '麦当劳连接暂时中断，请稍后重试。';
}

// A client belongs to one credential scope. Never consult a process-wide token.
export function createMcd(token) {
  let clientPromise, closed = false;
  function disconnect() {
    const old = clientPromise;
    clientPromise = undefined;
    old?.then(c => c.close()).catch(() => {});
  }
  async function connect() {
    if (closed) throw new ServiceError('连接已断开，请重新连接。', 401);
    if (!clientPromise) {
      const pending = (async () => {
        const client = new Client({ name: 'mai-pick', version: '1.1.0' });
        try {
          await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp.mcd.cn'), {
            requestInit: { headers: { Authorization: `Bearer ${token}` } },
          }));
          if (closed) { await client.close(); throw new ServiceError('连接已断开，请重新连接。', 401); }
          return client;
        } catch (error) { await client.close().catch(() => {}); throw error; }
      })();
      clientPromise = pending;
      pending.catch(() => { if (clientPromise === pending) clientPromise = undefined; });
    }
    return clientPromise;
  }
  return {
    async callMcd(name, args = {}) {
      try {
        const client = await connect();
        return unwrapResponse(await client.callTool({ name, arguments: args }, undefined, { timeout: 25000 }));
      } catch (error) {
        if (!(error instanceof ServiceError)) disconnect();
        throw new ServiceError(safeError(error, token), error.status ?? 502);
      }
    },
    close() { closed = true; disconnect(); },
  };
}
