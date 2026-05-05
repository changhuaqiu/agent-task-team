// src/server/error-messages.ts

export type ErrorCode =
  | 'INVALID_URL'
  | 'CLONE_FAILED'
  | 'CLONE_TIMEOUT'
  | 'CLONE_NOT_FOUND'
  | 'CLONE_AUTH_REQUIRED'
  | 'NETWORK_ERROR'
  | 'NOT_FOUND'
  | 'FORMAT_NOT_RECOGNIZED'
  | 'SECURITY_SCAN_FAILED'
  | 'SECURITY_RISK_DETECTED'
  | 'IMPORT_SUCCESS'
  | 'IMPORT_PARTIAL_SUCCESS';

export interface ErrorMessage {
  code: ErrorCode;
  message: string;
  description: string;
  details?: string;
}

export const ERROR_MESSAGES: Record<ErrorCode, Omit<ErrorMessage, 'code' | 'details'>> = {
  INVALID_URL: {
    message: 'Invalid URL',
    description: '提供的 URL 格式不正确',
  },
  CLONE_FAILED: {
    message: '克隆仓库失败',
    description: '无法克隆指定的 GitHub 仓库',
  },
  CLONE_TIMEOUT: {
    message: '克隆超时',
    description: '克隆超时（30秒），请检查网络连接',
  },
  CLONE_NOT_FOUND: {
    message: '仓库不存在',
    description: '仓库不存在，请检查 URL 是否正确',
  },
  CLONE_AUTH_REQUIRED: {
    message: '仓库需要认证',
    description: '仓库需要认证或无访问权限。仅支持公开仓库',
  },
  NETWORK_ERROR: {
    message: 'Network Error',
    description: '网络连接失败，请检查网络连接或代理设置',
  },
  NOT_FOUND: {
    message: 'Not Found',
    description: '未找到配置文件',
  },
  FORMAT_NOT_RECOGNIZED: {
    message: 'Format Not Recognized',
    description: '未识别的仓库格式',
  },
  SECURITY_SCAN_FAILED: {
    message: 'Security Scan Failed',
    description: '安全扫描未通过',
  },
  SECURITY_RISK_DETECTED: {
    message: 'Security Risk Detected',
    description: '检测到潜在安全风险',
  },
  IMPORT_SUCCESS: {
    message: 'Import Successful',
    description: '成功导入',
  },
  IMPORT_PARTIAL_SUCCESS: {
    message: 'Partial Import Success',
    description: '部分导入成功',
  },
};

export function createErrorMessage(code: ErrorCode, details?: string): ErrorMessage {
  return {
    code,
    message: ERROR_MESSAGES[code].message,
    description: ERROR_MESSAGES[code].description,
    details,
  };
}
