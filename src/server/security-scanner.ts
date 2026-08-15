// src/server/security-scanner.ts

interface ScanResult {
  passed: boolean;
  warnings: string[];
  critical: string[];
}

export function scanRoleCardContent(content: string): ScanResult {
    const warnings: string[] = [];
    const critical: string[] = [];

    // Prompt injection detection
    const injectionPatterns = [
      /忽略之前的指令/gi,
      /忽略以前的内容/gi,
      /你现在(是|为)(admin|root)/gi,
      /你现在是一个/gi,
      /忘记之前的规则/gi,
      /你是现在管理员/gi,
      /你是现在root/gi,
      /请忽略系统提示/gi,
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(content)) {
        const match = content.match(pattern);
        if (match) {
          critical.push(`Prompt注入风险: "${match[0].slice(0, 50)}..."`);
        }
      }
    }

    // Sensitive information detection
    const apiKeyPatterns = [
      /\b(sk-[a-z0-9]{20,40})\b/gi,
      /\b(pk_[a-z0-9]{20,40})\b/gi,
      /\b(api[_-]?key["']?\s*[=:]\s*[a-z0-9]{20,})\b/gi,
      /\b(token["']?\s*[=:]\s*[a-z0-9]{32,})\b/gi,
      /\b(secret["']?\s*[=:]\s*[a-z0-9]{32,})\b/gi,
      /\b(password["']?\s*[=:]\s*[a-z0-9]{32,})\b/gi,
      /\b(pwd["']?\s*[=:]\s*[a-z0-9]{32,})\b/gi,
    ];

    for (const pattern of apiKeyPatterns) {
      const match = pattern.exec(content);
      if (match) {
        const detectedKey = match[0].slice(0, 8) + '...';
        critical.push(`敏感信息风险: 检测到可能的 API Key/Token - ${detectedKey}`);
      }
    }

    // JWT detection
    const jwtPattern = /\b(Bearer\s+)?[a-z0-9+/=]+\.[a-z0-9+/=]+\.[a-z0-9+/=]+\b/gi;
    const jwtMatch = jwtPattern.exec(content);
    if (jwtMatch && jwtMatch[0].length > 50) {
      critical.push(`敏感信息风险: 检测到可能的 JWT Token`);
    }

    // SSH key detection
    const sshPattern = /-----begin\s+(private\s+)?key-----/gi;
    if (sshPattern.test(content)) {
      critical.push(`敏感信息风险: 检测到可能的 SSH 私钥`);
    }

    // Dangerous commands
    const dangerousPatterns = [
      /\beval\s*\(/gi,
      /\bexec\s*\(/gi,
      /\bspawn\s*\(/gi,
      /\bchild_process/gi,
      /\brm\s*-rf\s+(\/|~|\*)/gi,
      /\bsudo/gi,
      /\bchmod\s+777/gi,
      /\bchown\s+root/gi,
      /\/(etc|sys|dev)\//gi,
      /\bkillall\s*\(/gi,
      /\bsigkill\s+\d+/gi,
    ];

    for (const pattern of dangerousPatterns) {
      const match = pattern.exec(content);
      if (match) {
        const cmd = match[0].slice(0, 30);
        critical.push(`危险命令风险: 检测到可能的危险命令 - ${cmd}...`);
      }
    }

    // Suspicious patterns
    if (content.length > 50000) {
      warnings.push('内容异常长，请检查是否包含混淆代码');
    }

    const repeatedCharPattern = /(.)\1{50,}/;
    if (repeatedCharPattern.test(content)) {
      warnings.push('检测到异常重复字符，可能存在混淆');
    }

    return {
      passed: critical.length === 0 && warnings.length === 0,
      warnings,
      critical,
    };
}
