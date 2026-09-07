const messageOf = error => error instanceof Error ? error.message : String(error || 'Unknown error');

export function diagnosticFromError(error, { phase = 'runtime', relevantSymbol = null, validationPath = null, errorCode: suppliedErrorCode = null } = {}) {
  const message = messageOf(error);
  const explicitErrorCode = typeof error?.code === 'string' ? error.code : null;
  const errorCode = suppliedErrorCode || explicitErrorCode || (
    error instanceof SyntaxError ? 'JSON_PARSE_ERROR' :
    phase === 'storage_read' ? 'STORAGE_READ_ERROR' :
    phase === 'storage_write' ? 'STORAGE_WRITE_ERROR' :
    phase === 'serialization' ? 'SERIALIZATION_ERROR' :
    phase === 'migration' ? 'MIGRATION_ERROR' :
    phase === 'render' ? 'RENDER_STATE_ERROR' :
    phase === 'external_write' ? 'EXTERNAL_WRITE_CONFLICT' :
    /schema|版本不兼容/.test(message) ? 'SCHEMA_ERROR' :
    /状态|卡片|机会|记录|交易方向|阶段|登记/.test(message) ? 'STATE_VALIDATION_ERROR' :
    'INVARIANT_ERROR'
  );
  return Object.freeze({
    errorCode,
    phase,
    message,
    cause: error?.cause instanceof Error ? error.cause.message : error?.name || null,
    relevantSymbol,
    validationPath: error?.path || validationPath || null
  });
}

export function reportDiagnostic(error, context) {
  const diagnostic = diagnosticFromError(error, context);
  console.error('[intraday-task-cards diagnostic]', diagnostic);
  return diagnostic;
}
