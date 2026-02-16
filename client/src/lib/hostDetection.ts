const host = window.location.host;
const isReplit = host.includes("repl") || host.includes("replit");

export const isDriverHost = !isReplit && host.startsWith("driver.");
export const isAdminHost = !isReplit && host.startsWith("admin.");
export const isAppHost = !isReplit && host.startsWith("app.");
export const isProductionSubdomain = isDriverHost || isAdminHost || isAppHost;
export { isReplit };
