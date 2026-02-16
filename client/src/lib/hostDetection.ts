const host = window.location.host;
const isProdDomain = host.endsWith("unitedcaremobility.com");

export const isDriverHost = isProdDomain && host.startsWith("driver.");
export const isAdminHost = isProdDomain && host.startsWith("admin.");
export const isAppHost = isProdDomain && (host.startsWith("app.") || host === "app.unitedcaremobility.com");
export const isProductionSubdomain = isDriverHost || isAdminHost || isAppHost;
export { isProdDomain };
