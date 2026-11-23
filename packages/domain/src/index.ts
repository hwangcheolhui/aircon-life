// 브라우저·서버 공용 진입점 (Node 전용 API 없음). 서버 전용은 '@aircon/domain/server'.
export * from './rbac/admin-menus';
export * from './rbac/permission-matrix';
export * from './rbac/access';
export * from './rbac/preview';
export * from './auth/login-policy';
export * from './pii/mask';
export * from './pricing/price-policy';
export * from './settings';
export * from './messages';
export * from './quote/quote-calc';
export * from './quote/quote-status';
export * from './order/order-status';
export * from './order/order-rules';
export * from './slot/slot';
export * from './customer/consent';
export * from './customer/notify-template';
export * from './area/area-open-request';
