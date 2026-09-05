const ROLE_ALIASES={ADMIN:'SUPERADMIN',OWNER:'SUPERADMIN',CS:'CUSTOMER_SERVICE',CUSTOMER_SERVICE:'CUSTOMER_SERVICE',CUSTOMERSERVICE:'CUSTOMER_SERVICE',FINANCE:'FINANCE',OPS:'OPS',OPERATION:'OPS',OPERATIONS:'OPS',COURIER:'COURIER',SUPERADMIN:'SUPERADMIN'};
export const ADMIN_ROLES=['SUPERADMIN','FINANCE','OPS','CUSTOMER_SERVICE','COURIER'];
export function normalizeAdminRole(value){return ROLE_ALIASES[String(value||'').trim().toUpperCase()]||'CUSTOMER_SERVICE';}

const PATH_ROLES=[
 [/^\/(?:libra-admin|admin-tool)$/,ADMIN_ROLES],
 [/^\/jlx-soetta(?:\/(?:booking|marketplace|pti))?$/,['SUPERADMIN','OPS']],
 [/^\/courier(?:\/assignments|\/simulation)?$/,['SUPERADMIN','OPS','COURIER']],
 [/^\/admin-system-health$/,['SUPERADMIN']],
 [/^\/admin-partners$/,['SUPERADMIN','FINANCE']],
 [/^\/admin-rate-plans$/,['SUPERADMIN','FINANCE']],
 [/^\/admin-reconciliation$/,['SUPERADMIN','FINANCE']],
 [/^\/admin-finance-billing$/,['SUPERADMIN','FINANCE']],
 [/^\/admin-accurate(?:\/simulation)?$/,['SUPERADMIN','FINANCE']],
 [/^\/admin-quotes$/,['SUPERADMIN','FINANCE','OPS']],
 [/^\/admin-master-sheet$/,['SUPERADMIN','OPS']],
 [/^\/admin-maps(?:-pilot)?$/,['SUPERADMIN','OPS']],
 [/^\/admin-consolidation$/,['SUPERADMIN','FINANCE','OPS']],
 [/^\/admin-bookings$/,['SUPERADMIN','OPS','CUSTOMER_SERVICE']],
 [/^\/admin-courier$/,['SUPERADMIN','OPS']],
 [/^\/admin-courier-assignment$/,['SUPERADMIN','OPS']],
 [/^\/admin-manifests$/,['SUPERADMIN','OPS']],
 [/^\/admin-warehouse$/,['SUPERADMIN','OPS']],
 [/^\/admin-weights$/,['SUPERADMIN','OPS']],
 [/^\/admin-vendor-master$/,['SUPERADMIN','FINANCE','OPS']],
 [/^\/admin-profitability$/,['SUPERADMIN','FINANCE','OPS']],
 [/^\/admin-claims$/,['SUPERADMIN','FINANCE','OPS','CUSTOMER_SERVICE']],
 [/^\/admin-tickets(?:\/simulation)?$/,['SUPERADMIN','FINANCE','OPS','CUSTOMER_SERVICE']],
 [/^\/admin-sla-control$/,['SUPERADMIN','OPS','CUSTOMER_SERVICE']],
 [/^\/admin-api-onboarding$/,['SUPERADMIN','OPS']],
 [/^\/admin-api-uat$/,['SUPERADMIN','OPS']],
 [/^\/admin-api-partners$/,['SUPERADMIN','OPS']],
 [/^\/admin-api-security$/,['SUPERADMIN','OPS']],
 [/^\/admin-webhook-control$/,['SUPERADMIN','OPS']],
 [/^\/admin-partner-links$/,['SUPERADMIN','OPS','CUSTOMER_SERVICE']],
 [/^\/admin-audit-backup$/,['SUPERADMIN']],
 [/^\/admin-resilience$/,['SUPERADMIN']],
 [/^\/admin-privacy-security(?:\/simulation)?$/,['SUPERADMIN']],
 [/^\/admin-go-live(?:\/simulation)?$/,['SUPERADMIN']],
 [/^\/admin-approvals$/,['SUPERADMIN','FINANCE','OPS']],
];

export function canonicalAdminPath(pathname){let path=String(pathname||'/').split('?')[0];if(path.startsWith('/.netlify/functions/'))path=`/${path.slice('/.netlify/functions/'.length)}`;return path.replace(/\/$/,'')||'/';}
export function allowedRolesForPath(pathname){const path=canonicalAdminPath(pathname);for(const [pattern,roles] of PATH_ROLES)if(pattern.test(path))return [...roles];if(path.startsWith('/admin-'))return ['SUPERADMIN'];return ADMIN_ROLES;}
export function canRoleAccessPath(role,pathname){return allowedRolesForPath(pathname).includes(normalizeAdminRole(role));}

const PERMISSIONS={
 'partner.manage':['SUPERADMIN','FINANCE'],
 'wallet.adjust.request':['SUPERADMIN','FINANCE'],
 'rate.manage':['SUPERADMIN','FINANCE'],
 'finance.reconcile':['SUPERADMIN','FINANCE'],
 'finance.billing':['SUPERADMIN','FINANCE'],
 'quote.manage':['SUPERADMIN','FINANCE','OPS'],
 'booking.manage':['SUPERADMIN','OPS','CUSTOMER_SERVICE'],
 'master.manage':['SUPERADMIN','OPS'],
 'consolidation.manage':['SUPERADMIN','FINANCE','OPS'],
 'tracking.manage':['SUPERADMIN','OPS','COURIER'],
 'courier.assignment':['SUPERADMIN','OPS'],
 'manifest.manage':['SUPERADMIN','OPS'],
 'warehouse.manage':['SUPERADMIN','OPS'],
 'weight.manage':['SUPERADMIN','OPS'],
 'vendor.manage':['SUPERADMIN','FINANCE','OPS'],
 'profitability.manage':['SUPERADMIN','FINANCE','OPS'],
 'claim.manage':['SUPERADMIN','FINANCE','OPS','CUSTOMER_SERVICE'],
 'ticket.manage':['SUPERADMIN','FINANCE','OPS','CUSTOMER_SERVICE'],
 'sla.manage':['SUPERADMIN','OPS','CUSTOMER_SERVICE'],
 'api.manage':['SUPERADMIN','OPS'],
 'api.security':['SUPERADMIN','OPS'],
 'backup.manage':['SUPERADMIN'],
 'privacy.manage':['SUPERADMIN'],
 'go_live.manage':['SUPERADMIN'],
 'approval.review':['SUPERADMIN','FINANCE','OPS'],
};
export function hasAdminPermission(role,permission){return (PERMISSIONS[permission]||['SUPERADMIN']).includes(normalizeAdminRole(role));}
export function assertAdminPermission(session,permission){if(!session||!hasAdminPermission(session.role,permission)){const e=new Error(`Role ${normalizeAdminRole(session?.role)} tidak memiliki izin ${permission}.`);e.code='ADMIN_FORBIDDEN';e.httpStatus=403;throw e;}return true;}

export function roleMatrix(){return ADMIN_ROLES.map(role=>({role,areas:PATH_ROLES.filter(([,roles])=>roles.includes(role)).map(([pattern])=>String(pattern).replace(/^\//,'').replace(/\/$/,'')).length}));}
