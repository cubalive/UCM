import PDFDocument from "pdfkit";
import fs from "fs";

const doc = new PDFDocument({
  size: "LETTER",
  margins: { top: 50, bottom: 50, left: 55, right: 55 },
  info: {
    Title: "UCM Platform — Análisis Técnico Completo",
    Author: "Claude Code Analysis",
    Subject: "United Care Mobility — Technical Audit Report",
    CreationDate: new Date(),
  },
});

const output = fs.createWriteStream("/home/user/UCM_Analisis_Completo.pdf");
doc.pipe(output);

const COLORS = {
  primary: "#1a365d",
  secondary: "#2b6cb0",
  accent: "#3182ce",
  text: "#1a202c",
  muted: "#4a5568",
  light: "#e2e8f0",
  white: "#ffffff",
  success: "#38a169",
  warning: "#d69e2e",
  danger: "#e53e3e",
  bg: "#f7fafc",
};

let pageNum = 0;

function addHeader(text: string, size: number = 22, color: string = COLORS.primary) {
  doc.fontSize(size).fillColor(color).font("Helvetica-Bold").text(text);
  doc.moveDown(0.3);
}

function addSubheader(text: string) {
  doc.fontSize(14).fillColor(COLORS.secondary).font("Helvetica-Bold").text(text);
  doc.moveDown(0.2);
}

function addText(text: string, opts: any = {}) {
  doc.fontSize(opts.size || 10).fillColor(opts.color || COLORS.text).font(opts.bold ? "Helvetica-Bold" : "Helvetica").text(text, opts);
  doc.moveDown(0.15);
}

function addBullet(text: string, indent: number = 15) {
  const x = doc.x;
  doc.fontSize(10).fillColor(COLORS.text).font("Helvetica").text(`•  ${text}`, x + indent, undefined, { width: 490 - indent });
  doc.moveDown(0.1);
}

function addDivider() {
  doc.moveDown(0.3);
  const y = doc.y;
  doc.strokeColor(COLORS.light).lineWidth(1).moveTo(55, y).lineTo(557, y).stroke();
  doc.moveDown(0.5);
}

function addStat(label: string, value: string | number) {
  doc.fontSize(10).font("Helvetica-Bold").fillColor(COLORS.secondary).text(`${value}`, { continued: true });
  doc.font("Helvetica").fillColor(COLORS.muted).text(`  ${label}`);
  doc.moveDown(0.1);
}

function checkPage(needed: number = 100) {
  if (doc.y + needed > 700) {
    doc.addPage();
    pageNum++;
  }
}

function addSection(title: string) {
  checkPage(120);
  doc.moveDown(0.5);
  const y = doc.y;
  doc.rect(55, y, 502, 28).fill(COLORS.primary);
  doc.fontSize(14).fillColor(COLORS.white).font("Helvetica-Bold").text(title, 65, y + 7);
  doc.y = y + 36;
  doc.moveDown(0.3);
}

function addSmallSection(title: string) {
  checkPage(80);
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor(COLORS.secondary).font("Helvetica-Bold").text(`▸ ${title}`);
  doc.moveDown(0.2);
}

function addTableRow(cells: string[], isHeader: boolean = false) {
  checkPage(20);
  const x = 55;
  const colWidths = cells.length === 2 ? [250, 252] : cells.length === 3 ? [180, 160, 162] : [125, 125, 125, 127];
  const y = doc.y;

  if (isHeader) {
    doc.rect(x, y - 2, 502, 18).fill(COLORS.primary);
    doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(9);
  } else {
    doc.fillColor(COLORS.text).font("Helvetica").fontSize(9);
  }

  let cx = x;
  cells.forEach((cell, i) => {
    doc.text(cell, cx + 4, y + 2, { width: colWidths[i] - 8, lineBreak: false });
    cx += colWidths[i];
  });
  doc.y = y + 18;
}

// ═══════════════════════════════════════════
// COVER PAGE
// ═══════════════════════════════════════════
doc.rect(0, 0, 612, 792).fill(COLORS.primary);
doc.fontSize(38).fillColor(COLORS.white).font("Helvetica-Bold").text("UCM Platform", 55, 200, { align: "center" });
doc.moveDown(0.3);
doc.fontSize(18).fillColor("#90cdf4").font("Helvetica").text("United Care Mobility", { align: "center" });
doc.moveDown(1.5);
doc.fontSize(22).fillColor(COLORS.white).font("Helvetica-Bold").text("Análisis Técnico Completo", { align: "center" });
doc.moveDown(0.5);
doc.fontSize(12).fillColor("#90cdf4").text("Multi-tenant NEMT Management System", { align: "center" });
doc.moveDown(3);

doc.rect(180, doc.y, 252, 1).fill("#90cdf4");
doc.moveDown(1);

doc.fontSize(11).fillColor("#cbd5e0").font("Helvetica");
doc.text("Fecha: 11 de Marzo, 2026", { align: "center" });
doc.text("Generado por: Claude Code (Opus 4.6)", { align: "center" });
doc.text("Versión: 1.0.0", { align: "center" });

doc.moveDown(4);
doc.fontSize(9).fillColor("#718096").text("CONFIDENCIAL — Documento de uso interno", { align: "center" });

// ═══════════════════════════════════════════
// TABLE OF CONTENTS
// ═══════════════════════════════════════════
doc.addPage();
pageNum = 2;
addHeader("Índice de Contenidos", 20);
addDivider();

const toc = [
  "1. Resumen Ejecutivo",
  "2. Métricas del Codebase",
  "3. Arquitectura del Sistema",
  "4. Esquema de Base de Datos",
  "5. Sistema de Permisos (RBAC)",
  "6. API — Rutas y Controladores",
  "7. Motores de Lógica de Negocio",
  "8. Servicios de Facturación",
  "9. Portales (Clinic, Pharmacy, Broker, Driver)",
  "10. Páginas del Frontend",
  "11. Integraciones Externas",
  "12. Seguridad y Compliance",
  "13. Testing",
  "14. Infraestructura y Deployment",
  "15. Internacionalización",
  "16. Deuda Técnica y Riesgos",
  "17. Recomendaciones",
  "18. Conclusión",
];

toc.forEach((item) => {
  addText(item, { size: 11 });
});

// ═══════════════════════════════════════════
// 1. RESUMEN EJECUTIVO
// ═══════════════════════════════════════════
doc.addPage();
addSection("1. Resumen Ejecutivo");

addText("United Care Mobility (UCM) es una plataforma multi-tenant de gestión de transporte médico no emergencial (NEMT). El sistema administra flotas, conductores, pacientes, viajes, clínicas, facturación y despacho a través de múltiples ciudades y compañías.", { size: 11 });
doc.moveDown(0.3);

addSubheader("Alcance del Sistema");
addBullet("Gestión completa del ciclo de vida de viajes médicos (trip lifecycle)");
addBullet("Multi-tenancy con aislamiento por compañía y ciudad");
addBullet("4 portales especializados: Clínica, Farmacia, Broker, Driver");
addBullet("Facturación integrada: Medicaid, EDI 837/835, Stripe");
addBullet("Detección de fraude, predicción de demanda, optimización de rutas");
addBullet("Aplicaciones móviles (iOS/Android) via Capacitor");
addBullet("Cumplimiento HIPAA con cifrado PHI y auditoría");
addBullet("Soporte multilingüe (EN, ES, PT, HT)");

doc.moveDown(0.3);
addSubheader("Stack Tecnológico");
addTableRow(["Capa", "Tecnología"], true);
addTableRow(["Frontend", "React 18 + Vite + Tailwind CSS + shadcn/ui"]);
addTableRow(["Backend", "Express 5 + Node.js 22 + TypeScript"]);
addTableRow(["Base de Datos", "PostgreSQL (Supabase) + Drizzle ORM"]);
addTableRow(["Cache/Queue", "Upstash Redis"]);
addTableRow(["Autenticación", "JWT + Magic Link + Session"]);
addTableRow(["Pagos", "Stripe Connect"]);
addTableRow(["Mensajería", "Twilio (SMS) + Resend (Email) + FCM (Push)"]);
addTableRow(["Mapas", "Google Maps Platform"]);
addTableRow(["Deployment", "Railway (API + Worker separation)"]);
addTableRow(["Mobile", "Capacitor (iOS/Android)"]);

// ═══════════════════════════════════════════
// 2. MÉTRICAS DEL CODEBASE
// ═══════════════════════════════════════════
doc.addPage();
addSection("2. Métricas del Codebase");

addSubheader("Estadísticas Generales");
addStat("346,853", "líneas de código (TypeScript/TSX)");
addStat("1,098", "archivos TypeScript/TSX totales");
addStat("195", "tablas de base de datos");
addStat("82", "enums PostgreSQL definidos");
addStat("122", "dependencias de producción");
addStat("14", "dependencias de desarrollo");

doc.moveDown(0.3);
addSubheader("Distribución por Capa");
addTableRow(["Categoría", "Cantidad", "Descripción"], true);
addTableRow(["Rutas (Routes)", "51", "Archivos de definición de endpoints API"]);
addTableRow(["Controladores", "36", "Handlers de requests HTTP"]);
addTableRow(["Librerías/Engines", "133", "Motores de lógica de negocio"]);
addTableRow(["Servicios", "16", "Servicios de billing y finanzas"]);
addTableRow(["Middleware", "16", "Middleware de seguridad y contexto"]);
addTableRow(["Páginas UI", "86", "Componentes de página React"]);
addTableRow(["Componentes UI", "77", "Componentes reutilizables"]);
addTableRow(["Tests", "42", "Archivos de pruebas (Vitest)"]);

doc.moveDown(0.3);
addSubheader("Archivos Clave por Tamaño");
addTableRow(["Archivo", "Líneas"], true);
addTableRow(["shared/schema.ts", "4,818 líneas — Esquema completo DB"]);
addTableRow(["shared/permissions.ts", "334 líneas — Matriz RBAC"]);
addTableRow(["shared/tripStateMachine.ts", "295 líneas — Máquina de estados"]);

// ═══════════════════════════════════════════
// 3. ARQUITECTURA
// ═══════════════════════════════════════════
doc.addPage();
addSection("3. Arquitectura del Sistema");

addSubheader("Monorepo Structure");
addText("El proyecto usa un monorepo con un único package.json. El código se organiza en tres capas principales:");
doc.moveDown(0.2);

addSmallSection("client/ — Frontend SPA");
addBullet("React 18 con Vite como bundler");
addBullet("wouter para routing (ligero, ~1.5KB)");
addBullet("TanStack Query para data fetching y cache");
addBullet("Zustand para state management global");
addBullet("shadcn/ui + Radix para componentes UI accesibles");
addBullet("Tailwind CSS para estilos");
addBullet("i18next para internacionalización (4 idiomas)");

checkPage(200);
addSmallSection("server/ — API Backend");
addBullet("Express 5 con TypeScript estricto");
addBullet("Drizzle ORM para consultas type-safe a PostgreSQL");
addBullet("Separación API/Worker via RUN_MODE env var");
addBullet("Boot-time schema migrations inline");
addBullet("WebSocket server para actualizaciones en tiempo real");
addBullet("Job queue con Redis para tareas en background");
addBullet("Leader election para workers distribuidos");

checkPage(200);
addSmallSection("shared/ — Código Compartido");
addBullet("schema.ts — Fuente única de verdad para todas las tablas DB");
addBullet("permissions.ts — Matriz RBAC completa con 14 roles");
addBullet("tripStateMachine.ts — Máquina de estados determinística para viajes");

addSmallSection("Patrones Arquitectónicos");
addBullet("Multi-tenancy estricta: tenantGuard middleware, requireCompanyScope, requireTenantScope");
addBullet("City-scoped data segregation con cityContext middleware");
addBullet("Event-driven: eventBus para comunicación entre módulos");
addBullet("Circuit breaker pattern para resiliencia");
addBullet("Rate limiting distribuido via Redis");
addBullet("Idempotency keys para operaciones críticas");
addBullet("Request tracing con IDs únicos");

// ═══════════════════════════════════════════
// 4. ESQUEMA DE BASE DE DATOS
// ═══════════════════════════════════════════
doc.addPage();
addSection("4. Esquema de Base de Datos (195 tablas)");

addSubheader("Tablas por Dominio");

const tableDomains: Record<string, string[]> = {
  "Core — Usuarios y Tenancy": ["users", "companies", "companyCities", "companySettings", "cities", "citySettings", "usCities", "usStates", "loginTokens", "sessionRevocations", "appSettings"],
  "Viajes (Trips)": ["trips", "tripEvents", "tripRoutes", "tripRoutePlans", "tripRouteEvents", "tripRouteSummary", "tripRoutePointChunks", "tripLocationPoints", "tripMessages", "tripNotes", "tripPdfs", "tripConfirmations", "tripSeries", "tripShareTokens", "tripSignatures", "tripSmsLog", "tripBilling", "tripRequests", "tripGroups", "tripGroupMembers"],
  "Conductores (Drivers)": ["drivers", "driverShifts", "driverDevices", "driverPushTokens", "driverSettings", "driverScores", "driverPerfScores", "driverRiskScores", "driverOffers", "driverEarningsLedger", "driverEarningsAdjustments", "driverStripeAccounts", "driverVehicleAssignments", "driverWeeklySchedules", "driverShiftSwapRequests", "driverBonusRules", "driverPayRules", "driverTripAlerts", "driverEmergencyEvents", "driverSupportEvents", "driverTelemetryEvents", "driverReplacements"],
  "Pacientes": ["patients", "patientRatings"],
  "Clínicas": ["clinics", "clinicBillingProfiles", "clinicBillingRules", "clinicBillingSettings", "clinicBillingInvoices", "clinicBillingInvoiceLines", "clinicCapacityConfig", "clinicCertifications", "clinicCompanies", "clinicFeatures", "clinicForecastSnapshots", "clinicHelpRequests", "clinicInvoiceItems", "clinicInvoicesMonthly", "clinicMemberships", "clinicQuarterlyReports", "clinicQuarterlyReportMetrics", "clinicTariffs", "clinicAlertLog"],
  "Farmacia": ["pharmacies", "pharmacyOrders", "pharmacyOrderItems", "pharmacyOrderEvents"],
  "Brokers": ["brokers", "brokerApiKeys", "brokerApiLogs", "brokerContracts", "brokerRateCards", "brokerTripRequests", "brokerBids", "brokerSettlements", "brokerSettlementItems", "brokerEvents", "brokerPerformanceMetrics", "brokerWebhooks", "brokerWebhookDeliveries"],
  "Facturación": ["invoices", "invoicePayments", "invoiceSequences", "billingAdjustments", "billingCycleInvoices", "billingCycleInvoiceItems", "billingAuditEvents", "billingAuditLog", "feeRules", "feeRuleAudit", "ledgerEntries", "financialLedger", "pricingRules", "pricingProfiles", "pricingAuditLog"],
  "Medicaid y EDI": ["medicaidClaims", "medicaidBillingCodes", "medicaidRemittance", "ediClaims", "ediClaimEvents"],
  "Operaciones": ["vehicles", "vehicleAssignmentHistory", "vehicleMakes", "vehicleModels", "assignmentBatches", "autoAssignRuns", "autoAssignRunCandidates", "routeBatches", "routeCache", "scheduleChangeRequests", "recurringSchedules", "recurringHolds", "recurringCancellationLog", "recurringCancellationPolicies", "recurringPricingOverrides"],
};

for (const [domain, tables] of Object.entries(tableDomains)) {
  checkPage(60);
  addSmallSection(`${domain} (${tables.length} tablas)`);
  // Show in compact format
  const chunks: string[] = [];
  for (let i = 0; i < tables.length; i += 3) {
    chunks.push(tables.slice(i, i + 3).join(", "));
  }
  chunks.forEach((chunk) => addBullet(chunk));
}

// ═══════════════════════════════════════════
// 5. RBAC
// ═══════════════════════════════════════════
doc.addPage();
addSection("5. Sistema de Permisos (RBAC)");

addText("El sistema implementa un control de acceso basado en roles (RBAC) con 14 roles distintos, definidos en shared/permissions.ts.");
doc.moveDown(0.3);

addSubheader("Roles del Sistema");
addTableRow(["Rol", "Descripción", "Acceso"], true);
addTableRow(["SUPER_ADMIN", "Administrador de plataforma", "Acceso total a todo"]);
addTableRow(["ADMIN", "Admin de compañía", "Gestión completa de compañía"]);
addTableRow(["COMPANY_ADMIN", "Admin operativo", "Operaciones de compañía"]);
addTableRow(["DISPATCH", "Despachador", "Asignación y tracking de viajes"]);
addTableRow(["DRIVER", "Conductor", "App de conductor, viajes asignados"]);
addTableRow(["VIEWER", "Observador", "Solo lectura"]);
addTableRow(["CLINIC_ADMIN", "Admin de clínica", "Gestión de clínica y viajes"]);
addTableRow(["CLINIC_USER", "Usuario de clínica", "Solicitar viajes"]);
addTableRow(["CLINIC_VIEWER", "Observador de clínica", "Solo lectura clínica"]);
addTableRow(["BROKER_ADMIN", "Admin de broker", "Gestión de contratos y trips"]);
addTableRow(["BROKER_USER", "Usuario de broker", "Solicitar viajes"]);
addTableRow(["PHARMACY_ADMIN", "Admin de farmacia", "Gestión de órdenes"]);
addTableRow(["PHARMACY_USER", "Usuario de farmacia", "Crear órdenes"]);

doc.moveDown(0.3);
addSubheader("Middleware de Scope");
addBullet("tenantGuard — Enforce multi-tenancy en todas las queries");
addBullet("requireCompanyScope — Validar pertenencia a compañía");
addBullet("requireTenantScope — Validar pertenencia a tenant");
addBullet("requireClinicScope — Validar acceso de clínica");
addBullet("requirePharmacyScope — Validar acceso de farmacia");
addBullet("requireBrokerScope — Validar acceso de broker");
addBullet("requireCityAccess — Validar acceso a ciudad específica");

// ═══════════════════════════════════════════
// 6. API
// ═══════════════════════════════════════════
doc.addPage();
addSection("6. API — Rutas y Controladores (51 rutas)");

addSubheader("Módulos de API");
const routes = [
  ["auth.routes.ts", "Autenticación JWT, magic link, login/logout"],
  ["admin.routes.ts", "Panel de administración, gestión de compañías"],
  ["trips.routes.ts", "CRUD de viajes, transiciones de estado"],
  ["drivers.routes.ts", "Gestión de conductores, documentos"],
  ["patients.routes.ts", "Gestión de pacientes"],
  ["clinics.routes.ts", "Gestión de clínicas"],
  ["vehicles.routes.ts", "Gestión de flota vehicular"],
  ["users.routes.ts", "Gestión de usuarios y roles"],
  ["cities.routes.ts", "Gestión de ciudades"],
  ["invoices.routes.ts", "Facturación y generación de facturas"],
  ["billingV2.routes.ts", "Sistema de facturación v2"],
  ["edi.routes.ts", "EDI 837 claims / 835 remittances"],
  ["medicaid.routes.ts", "Facturación Medicaid"],
  ["broker-api-v1.routes.ts", "API externa para brokers (HMAC auth)"],
  ["broker-portal.routes.ts", "Portal de brokers"],
  ["clinic-portal.routes.ts", "Portal de clínicas"],
  ["pharmacy-portal.routes.ts", "Portal de farmacias"],
  ["driver-portal.routes.ts", "Portal/App de conductores"],
  ["health.routes.ts", "Health checks (liveness/readiness)"],
  ["analytics.routes.ts", "Métricas y analytics"],
  ["ai.routes.ts", "Dashboard de AI e inteligencia"],
  ["intelligence.routes.ts", "Publicaciones de inteligencia"],
  ["sla.routes.ts", "Métricas de SLA"],
  ["ratings.routes.ts", "Sistema de calificaciones"],
  ["reconciliation.routes.ts", "Reconciliación de pagos"],
  ["inter-city.routes.ts", "Transferencias inter-ciudad"],
  ["dead-mile.routes.ts", "Tracking de millas muertas"],
  ["cascade-alerts.routes.ts", "Alertas de cascada"],
  ["smart-cancel.routes.ts", "Cancelación inteligente"],
  ["trip-groups.routes.ts", "Agrupación de viajes"],
  ["subscription.routes.ts", "Gestión de suscripciones"],
  ["compliance.routes.ts", "Compliance y auditoría"],
  ["imports.routes.ts", "Importación de datos CSV/Excel"],
  ["queue.routes.ts", "Cola de trabajos background"],
  ["ops.routes.ts", "Operaciones y monitoreo"],
  ["delivery-proof.routes.ts", "Pruebas de entrega (foto/firma)"],
  ["chatbot.routes.ts", "Chatbot de soporte AI"],
  ["ehr.routes.ts", "Integración EHR/FHIR"],
  ["branding.routes.ts", "Branding personalizado por empresa"],
];

routes.forEach(([route, desc]) => {
  checkPage(20);
  addTableRow([route, desc]);
});

// ═══════════════════════════════════════════
// 7. MOTORES DE NEGOCIO
// ═══════════════════════════════════════════
doc.addPage();
addSection("7. Motores de Lógica de Negocio (133 módulos)");

addText("El directorio server/lib/ contiene 133 módulos que implementan la lógica central del sistema:");
doc.moveDown(0.3);

const engines: Record<string, string[]> = {
  "Asignación y Dispatch": [
    "assignmentEngine.ts — Motor principal de asignación de viajes",
    "autoAssignV2Engine.ts — Auto-asignación v2 con scoring",
    "vehicleAutoAssign.ts — Asignación automática de vehículos",
    "aiDispatchBot.ts — Bot de dispatch con AI",
    "dispatchWindowEngine.ts — Ventanas de dispatch temporales",
    "rankingEngine.ts — Motor de ranking de conductores",
  ],
  "Rutas y Navegación": [
    "routeEngine.ts — Motor de cálculo de rutas",
    "routeOptimizationEngine.ts — Optimización de rutas",
    "multiStopOptimizer.ts — Optimizador multi-parada",
    "etaEngine.ts — Cálculo de ETA",
    "etaVarianceEngine.ts — Varianza de ETA y escalamiento",
    "googleMaps.ts — Integración Google Maps Platform",
  ],
  "Tracking y Tiempo Real": [
    "realtime.ts — WebSocket server",
    "supabaseRealtime.ts — Integración Supabase Realtime",
    "driverLocationIngest.ts — Ingesta de ubicaciones GPS",
    "breadcrumbBuffer.ts — Buffer de breadcrumbs GPS",
    "geofenceEvaluator.ts — Evaluación de geofences",
    "gpsPingQuality.ts — Calidad de señal GPS",
  ],
  "Facturación Avanzada": [
    "edi837Engine.ts — Generación de claims EDI 837",
    "edi835Parser.ts — Parsing de remittances EDI 835",
    "medicaidBillingEngine.ts — Ciclo de vida Medicaid",
    "pricingResolver.ts — Resolución de precios",
    "paymentReconciliationEngine.ts — Reconciliación de pagos",
  ],
  "Seguridad y Compliance": [
    "phiEncryption.ts — Cifrado de PHI (HIPAA)",
    "fraudDetectionEngine.ts — Detección de fraude",
    "auditShieldEngine.ts — Auditoría de seguridad",
    "complianceEngine.ts — Motor de compliance",
    "rateLimiter.ts — Rate limiting distribuido",
    "circuitBreaker.ts — Circuit breaker pattern",
  ],
  "Inteligencia y Predicción": [
    "aiEngine.ts — Motor de AI central",
    "demandPredictionEngine.ts — Predicción de demanda",
    "predictionEngine.ts — Motor de predicciones",
    "clinicForecastEngine.ts — Forecast para clínicas",
    "driverScoreEngine.ts — Scoring de conductores",
    "cityComparisonEngine.ts — Comparación entre ciudades",
    "opsIntelligence.ts — Inteligencia operacional",
  ],
  "Comunicaciones": [
    "twilioSms.ts — SMS via Twilio",
    "email.ts — Email via Resend",
    "push.ts — Push notifications via FCM",
    "smsConfirmationEngine.ts — Confirmaciones por SMS",
    "smsReminderScheduler.ts — Recordatorios programados",
    "pharmacyNotifications.ts — Notificaciones farmacia",
  ],
  "Operaciones Especiales": [
    "cascadeDelayEngine.ts — Manejo de delays en cascada",
    "smartCancellationEngine.ts — Cancelación inteligente",
    "tripGroupingEngine.ts — Agrupación de viajes",
    "interCityTransferEngine.ts — Transferencias inter-ciudad",
    "deadMileEngine.ts — Tracking de millas muertas",
    "noShowEngine.ts — Manejo de no-shows",
    "zeroTouchDialysisEngine.ts — Automatización de diálisis",
    "smartPickupEngine.ts — Sugerencias de recogida inteligente",
    "stuckTripDetector.ts — Detección de viajes atascados",
  ],
};

for (const [category, items] of Object.entries(engines)) {
  checkPage(80);
  addSmallSection(category);
  items.forEach((item) => addBullet(item));
}

// ═══════════════════════════════════════════
// 8. SERVICIOS DE FACTURACIÓN
// ═══════════════════════════════════════════
doc.addPage();
addSection("8. Servicios de Facturación (16 servicios)");

addText("El directorio server/services/ contiene la lógica financiera y de facturación:");
doc.moveDown(0.3);

const services = [
  ["billingEngine.ts", "Motor principal de facturación — cálculos de tarifas y billing cycles"],
  ["autoInvoiceScheduler.ts", "Generación automática de facturas en base a ciclos configurados"],
  ["autoReconciliationScheduler.ts", "Reconciliación automática de pagos y transacciones"],
  ["billingAuditService.ts", "Auditoría de transacciones de facturación"],
  ["dunningService.ts", "Gestión de cobros vencidos y seguimiento de pagos"],
  ["dunningEmailService.ts", "Emails automáticos de recordatorio de pago"],
  ["invoiceEmailService.ts", "Envío de facturas por email"],
  ["emailService.ts", "Servicio base de email"],
  ["feeRules.ts", "Reglas de tarifas y fees configurables"],
  ["financialEngine.ts", "Motor financiero central"],
  ["ledgerService.ts", "Libro mayor (general ledger) de transacciones"],
  ["platformFee.ts", "Cálculo de fees de plataforma"],
  ["payoutReconciliationService.ts", "Reconciliación de payouts a conductores"],
  ["stripeCustomerService.ts", "Gestión de clientes Stripe"],
  ["subscriptionService.ts", "Gestión de suscripciones de compañías"],
  ["subscriptionTiers.ts", "Definición de niveles de suscripción y features"],
];

services.forEach(([name, desc]) => {
  checkPage(30);
  doc.fontSize(10).font("Helvetica-Bold").fillColor(COLORS.secondary).text(name, { continued: true });
  doc.font("Helvetica").fillColor(COLORS.muted).text(` — ${desc}`);
  doc.moveDown(0.15);
});

// ═══════════════════════════════════════════
// 9. PORTALES
// ═══════════════════════════════════════════
doc.addPage();
addSection("9. Portales Especializados");

addSubheader("Portal de Clínicas (clinic-portal/)");
addBullet("Layout dedicado con sidebar y navegación propia");
addBullet("Solicitud de viajes para pacientes");
addBullet("Tracking en tiempo real de viajes activos");
addBullet("Facturación y reportes de uso");
addBullet("Gestión de usuarios de clínica (CLINIC_ADMIN, CLINIC_USER, CLINIC_VIEWER)");
addBullet("Forecast de demanda para planificación");

doc.moveDown(0.3);
addSubheader("Portal de Farmacia (pharmacy-portal/)");
addBullet("Gestión de órdenes de entrega farmacéutica");
addBullet("Tracking de entregas con proof of delivery");
addBullet("Notificaciones de estado de orden");
addBullet("Métricas de rendimiento (tiempo de entrega, tasa de éxito)");
addBullet("Requisitos de temperatura para medicamentos sensibles");
addBullet("Roles: PHARMACY_ADMIN, PHARMACY_USER");

doc.moveDown(0.3);
addSubheader("Portal de Brokers (broker-portal/)");
addBullet("Dashboard con métricas de performance");
addBullet("Gestión de contratos y rate cards");
addBullet("Solicitudes de viajes con bidding system");
addBullet("Settlements y reconciliación financiera");
addBullet("Marketplace para ofertas de viajes");
addBullet("API v1 externa con autenticación HMAC");
addBullet("Webhooks configurables para eventos");

doc.moveDown(0.3);
addSubheader("App de Conductores v4 (driver-v4/)");
addBullet("Diseño completamente renovado v4");
addBullet("Mapa de ruta real con navegación integrada");
addBullet("Proof of delivery: captura de foto + firma digital");
addBullet("Gestión de shifts y disponibilidad");
addBullet("Sistema de ofertas de viajes (accept/decline)");
addBullet("Push notifications via Firebase Cloud Messaging");
addBullet("Capacitor wrapper para iOS y Android");

// ═══════════════════════════════════════════
// 10. PÁGINAS FRONTEND
// ═══════════════════════════════════════════
doc.addPage();
addSection("10. Páginas del Frontend (86 páginas)");

const pageCategories: Record<string, string[]> = {
  "Operaciones Core": [
    "dashboard.tsx — Dashboard principal",
    "trips.tsx — Lista y gestión de viajes",
    "trip-detail.tsx — Detalle de viaje",
    "dispatch-board.tsx — Tablero de dispatch",
    "dispatch-map.tsx — Mapa de dispatch en vivo",
    "live-map.tsx — Mapa en tiempo real",
    "schedule.tsx — Programación de viajes",
    "assignments.tsx — Asignaciones de viajes",
  ],
  "Gestión de Personal": [
    "drivers.tsx — Lista de conductores",
    "driver-detail.tsx — Detalle de conductor",
    "driver-dashboard.tsx — Dashboard del conductor",
    "driver-performance.tsx — Performance del conductor",
    "driver-earnings.tsx — Ganancias del conductor",
    "driver-portal.tsx — Portal del conductor",
    "users-management.tsx — Gestión de usuarios",
    "timecards.tsx — Tarjetas de tiempo",
  ],
  "Pacientes y Clínicas": [
    "patients.tsx — Lista de pacientes",
    "patient-detail.tsx — Detalle de paciente",
    "clinics.tsx — Lista de clínicas",
    "clinic-detail.tsx — Detalle de clínica",
    "clinic-users.tsx — Usuarios de clínica",
    "clinic-trips.tsx — Viajes de clínica",
    "clinic-billing.tsx — Facturación de clínica",
    "clinic-billing-v2.tsx — Facturación v2",
  ],
  "Finanzas y Facturación": [
    "billing.tsx — Facturación general",
    "billing-tariffs.tsx — Tarifas",
    "invoice-detail.tsx — Detalle de factura",
    "edi-billing.tsx — Facturación EDI 837/835",
    "medicaid-billing.tsx — Facturación Medicaid",
    "pricing.tsx — Configuración de precios",
    "fee-rules.tsx — Reglas de tarifas",
    "finance-console.tsx — Consola financiera",
    "reconciliation.tsx — Reconciliación",
    "platform-fees.tsx — Fees de plataforma",
    "subscriptions.tsx — Suscripciones",
  ],
  "Inteligencia y AI": [
    "ai-dashboard.tsx — Dashboard de AI",
    "intelligence.tsx — Inteligencia operacional",
    "prediction.tsx — Predicciones de demanda",
    "city-comparison.tsx — Comparación de ciudades",
    "metrics.tsx — Métricas generales",
    "indexes.tsx — Índices operativos",
  ],
  "Operaciones Avanzadas": [
    "cascade-alerts.tsx — Alertas de cascada",
    "smart-cancel.tsx — Cancelación inteligente",
    "trip-groups.tsx — Grupos de viajes",
    "inter-city.tsx — Transferencias inter-ciudad",
    "dead-mile.tsx — Millas muertas",
    "ratings-dashboard.tsx — Dashboard de ratings",
    "marketplace.tsx — Marketplace de viajes",
    "eta-escalations.tsx — Escalaciones de ETA",
    "fleet-ops.tsx — Operaciones de flota",
    "auto-assignment.tsx — Auto-asignación",
    "zero-touch-dialysis.tsx — Automatización diálisis",
  ],
};

for (const [category, pages] of Object.entries(pageCategories)) {
  checkPage(80);
  addSmallSection(`${category} (${pages.length} páginas)`);
  pages.forEach((p) => addBullet(p));
}

// ═══════════════════════════════════════════
// 11. INTEGRACIONES
// ═══════════════════════════════════════════
doc.addPage();
addSection("11. Integraciones Externas");

const integrations = [
  {
    name: "PostgreSQL (Supabase)",
    desc: "Base de datos principal con 195 tablas. Conexión via pg Pool + Drizzle ORM. Supabase proporciona también Realtime subscriptions para actualizaciones en vivo.",
    files: "server/db.ts, shared/schema.ts",
  },
  {
    name: "Google Maps Platform",
    desc: "Geocoding, Directions API, Distance Matrix, Places API. Usado para cálculo de rutas, ETAs, optimización de rutas multi-stop, y geocodificación de direcciones.",
    files: "server/lib/googleMaps.ts, server/lib/routeEngine.ts",
  },
  {
    name: "Stripe Connect",
    desc: "Procesamiento de pagos, suscripciones de compañías, payouts a conductores, customer management. Integración completa con webhooks para eventos de pago.",
    files: "server/lib/stripeConnectRoutes.ts, server/services/stripeCustomerService.ts",
  },
  {
    name: "Twilio",
    desc: "SMS transaccionales para confirmaciones, recordatorios, notificaciones de estado de viaje, opt-out management.",
    files: "server/lib/twilioSms.ts, server/lib/smsConfirmationEngine.ts",
  },
  {
    name: "Resend",
    desc: "Servicio de email transaccional para facturas, dunning (cobros), magic links, reportes programados.",
    files: "server/lib/email.ts, server/services/emailService.ts",
  },
  {
    name: "Firebase Cloud Messaging (FCM)",
    desc: "Push notifications para la app de conductores (iOS/Android). Notificaciones de nuevos viajes, cambios de estado, alertas.",
    files: "server/lib/push.ts",
  },
  {
    name: "Upstash Redis",
    desc: "Cache distribuido, job queue, rate limiting, leader election para workers, idempotency keys, backpressure management.",
    files: "server/lib/redis.ts, server/lib/cache.ts, server/lib/jobQueue.ts",
  },
  {
    name: "EHR/FHIR",
    desc: "Integración con Electronic Health Records via estándar FHIR para sincronización de citas médicas.",
    files: "server/lib/ehrFhirEngine.ts, server/routes/ehr.routes.ts",
  },
];

integrations.forEach((int) => {
  checkPage(80);
  addSmallSection(int.name);
  addText(int.desc);
  addText(`Archivos: ${int.files}`, { color: COLORS.muted, size: 9 });
});

// ═══════════════════════════════════════════
// 12. SEGURIDAD
// ═══════════════════════════════════════════
doc.addPage();
addSection("12. Seguridad y Compliance");

addSubheader("HIPAA Compliance");
addBullet("PHI Encryption — Cifrado de información médica protegida (server/lib/phiEncryption.ts)");
addBullet("PHI Audit Middleware — Registro de todo acceso a datos PHI (server/middleware/phiAudit.ts)");
addBullet("Data Retention Engine — Políticas de retención de datos configurables");
addBullet("Account Deletion — Cumplimiento de derecho al olvido");
addBullet("Audit Shield — Motor de auditoría de seguridad completo");

doc.moveDown(0.3);
addSubheader("Seguridad de Aplicación");
addBullet("Input Sanitizer — Sanitización de inputs contra XSS (server/middleware/inputSanitizer.ts)");
addBullet("Rate Limiter — Limitación de requests distribuida via Redis");
addBullet("Circuit Breaker — Protección contra fallos en cascada");
addBullet("Request Tracing — IDs únicos por request para debugging");
addBullet("Idempotency — Keys para prevenir operaciones duplicadas");
addBullet("HMAC Authentication — Para API de brokers externos");
addBullet("JWT + Session Auth — Doble capa de autenticación");
addBullet("Tenant Guard — Aislamiento estricto de datos entre tenants");

doc.moveDown(0.3);
addSubheader("Detección de Fraude");
addBullet("Fraud Detection Engine — Scoring de anomalías en viajes y facturación");
addBullet("Integrity Report — Reportes de integridad de datos");
addBullet("Billing Audit Service — Auditoría de transacciones financieras");
addBullet("No-Show Engine — Detección y gestión de no-shows sospechosos");
addBullet("GPS Ping Quality — Validación de calidad de señal GPS");
addBullet("Reroute Detector — Detección de desvíos de ruta sospechosos");

doc.moveDown(0.3);
addSubheader("Middleware de Seguridad (16 middlewares)");
addTableRow(["Middleware", "Función"], true);
addTableRow(["tenantGuard", "Enforce multi-tenancy"]);
addTableRow(["requireCompanyScope", "Validar scope de compañía"]);
addTableRow(["requireTenantScope", "Validar scope de tenant"]);
addTableRow(["requireClinicScope", "Validar scope de clínica"]);
addTableRow(["requirePharmacyScope", "Validar scope de farmacia"]);
addTableRow(["requireBrokerScope", "Validar scope de broker"]);
addTableRow(["requireCityAccess", "Validar acceso a ciudad"]);
addTableRow(["requireSubscription", "Verificar suscripción activa"]);
addTableRow(["inputSanitizer", "Sanitizar inputs contra XSS"]);
addTableRow(["rateLimiter", "Rate limiting por IP/usuario"]);
addTableRow(["performanceTracker", "Tracking de performance"]);
addTableRow(["phiAudit", "Auditoría de acceso a PHI"]);
addTableRow(["logAudit", "Log de auditoría general"]);
addTableRow(["cityContext", "Contexto de ciudad en request"]);
addTableRow(["scopeContext", "Contexto de scope general"]);

// ═══════════════════════════════════════════
// 13. TESTING
// ═══════════════════════════════════════════
doc.addPage();
addSection("13. Testing (42 archivos de tests)");

addSubheader("Framework y Configuración");
addBullet("Framework: Vitest con entorno Node");
addBullet("Ubicación: server/tests/, shared/, tests/unit/, tests/integration/");
addBullet("Comando: npx vitest run");
doc.moveDown(0.3);

addSubheader("Tests Unitarios (tests/unit/)");
const unitTests = [
  "tripStateMachine.test.ts — Máquina de estados de viajes",
  "tripFlowAndMultiTenant.test.ts — Flujo de viajes multi-tenant",
  "tripLifecycleAndMultiTenant.test.ts — Ciclo de vida completo",
  "billingAndSecurity.test.ts — Facturación y seguridad",
  "feeService.test.ts — Servicio de tarifas",
  "feeEdgeCases.test.ts — Casos borde de tarifas",
  "routingAndDispatch.test.ts — Routing y dispatch",
  "securityAndTimezone.test.ts — Seguridad y zonas horarias",
  "securityHardening.test.ts — Hardening de seguridad",
  "scaleAndTenantIsolation.test.ts — Escala y aislamiento",
  "importEngine.test.ts — Motor de importación",
  "validation.test.ts — Validaciones",
  "webhookIdempotency.test.ts — Idempotencia de webhooks",
  "adminAndPatientManagement.test.ts — Admin y pacientes",
  "platformHardening.test.ts — Hardening de plataforma",
  "platformValidation.test.ts — Validación de plataforma",
  "financialResilience.test.ts — Resiliencia financiera",
  "hardening.test.ts — Hardening general",
  "dataIntegrity.test.ts — Integridad de datos",
  "corsAndRequestId.test.ts — CORS y Request IDs",
  "envValidation.test.ts — Validación de env vars",
  "subscriptionAndEmail.test.ts — Suscripciones y email",
  "stripeLinks.test.ts — Links de Stripe",
  "passwordResetAndFinalPolish.test.ts — Reset de password",
];
unitTests.forEach((t) => addBullet(t));

checkPage(150);
addSubheader("Tests de Integración");
addBullet("billingFlow.test.ts — Flujo completo de facturación");
addBullet("billing-integration.test.ts — Integración de billing");
addBullet("billing-complete.test.ts — Billing end-to-end");
addBullet("trip-lifecycle.test.ts — Ciclo de vida de viajes");
addBullet("pharmacy-orders.test.ts — Órdenes de farmacia");
addBullet("scalability.test.ts — Pruebas de escalabilidad");
addBullet("reassign.test.ts — Reasignación de viajes");
addBullet("driverClassification.test.ts — Clasificación de conductores");

addSubheader("Tests Compartidos (shared/)");
addBullet("tripStateMachine.test.ts — State machine compartida");
addBullet("goldenContract.test.ts — Contratos golden");
addBullet("driverPerformance.test.ts — Performance de conductores");
addBullet("smartPrompts.test.ts — Prompts inteligentes");

// ═══════════════════════════════════════════
// 14. INFRAESTRUCTURA
// ═══════════════════════════════════════════
doc.addPage();
addSection("14. Infraestructura y Deployment");

addSubheader("Railway Deployment");
addBullet("Proceso API: 2 réplicas para alta disponibilidad (railway.toml)");
addBullet("Proceso Worker: 1 instancia para background jobs (railway.worker.toml)");
addBullet("Separación via RUN_MODE env var: 'api', 'worker', 'all'");
addBullet("Health checks: /api/health/live (liveness), /api/health/ready (readiness)");
addBullet("Build: tsx script/build.ts → dist/");

doc.moveDown(0.3);
addSubheader("Separación API/Worker");
addText("El sistema separa la lógica HTTP (API) de los background jobs (Worker) mediante la variable RUN_MODE:");
addBullet("API mode: Sirve HTTP requests, WebSocket connections, Vite dev server");
addBullet("Worker mode: Ejecuta schedulers, job processors, leader election");
addBullet("All mode: Ejecuta ambos (para desarrollo local)");

doc.moveDown(0.3);
addSubheader("Background Jobs");
addBullet("jobEngine.ts — Motor de ejecución de jobs");
addBullet("jobProcessor.ts — Procesador de cola de jobs");
addBullet("jobQueue.ts — Cola distribuida via Redis");
addBullet("jobHeartbeat.ts — Heartbeat de jobs activos");
addBullet("leaderElection.ts — Leader election para workers distribuidos");
addBullet("schedulerInit.ts — Inicialización de schedulers");
addBullet("schedulerHarness.ts — Harness para testing de schedulers");
addBullet("opsScheduler.ts — Scheduler operacional");

doc.moveDown(0.3);
addSubheader("Mobile (Capacitor)");
addBullet("mobile-driver/ — App de conductores (iOS/Android)");
addBullet("mobile-clinic/ — App de clínica");
addBullet("mobile-admin/ — App de administración");
addBullet("App Store readiness: account deletion, offline fallback, ATT compliance");

doc.moveDown(0.3);
addSubheader("Variables de Entorno Requeridas");
addTableRow(["Variable", "Servicio"], true);
addTableRow(["SUPABASE_DB_URL / DATABASE_URL", "PostgreSQL"]);
addTableRow(["UPSTASH_REDIS_REST_URL", "Redis"]);
addTableRow(["GOOGLE_MAPS_API_KEY", "Google Maps"]);
addTableRow(["TWILIO_ACCOUNT_SID / AUTH_TOKEN", "Twilio SMS"]);
addTableRow(["RESEND_API_KEY", "Email"]);
addTableRow(["STRIPE_SECRET_KEY", "Stripe"]);
addTableRow(["PHI_ENCRYPTION_KEY", "HIPAA Encryption"]);
addTableRow(["FIREBASE_*", "FCM Push"]);
addTableRow(["JWT_SECRET", "Auth"]);
addTableRow(["RUN_MODE", "api / worker / all"]);

// ═══════════════════════════════════════════
// 15. I18N
// ═══════════════════════════════════════════
doc.addPage();
addSection("15. Internacionalización");

addText("El sistema soporta 4 idiomas mediante i18next:");
doc.moveDown(0.3);

addTableRow(["Idioma", "Archivo", "Código"], true);
addTableRow(["Inglés", "client/src/i18n/en.json", "en"]);
addTableRow(["Español", "client/src/i18n/es.json", "es"]);
addTableRow(["Portugués", "client/src/i18n/pt.json", "pt"]);
addTableRow(["Criollo Haitiano", "client/src/i18n/ht.json", "ht"]);

doc.moveDown(0.3);
addText("La selección de idioma es persistente por usuario y se aplica a toda la interfaz del frontend, incluyendo los portales especializados.");

// ═══════════════════════════════════════════
// 16. DEUDA TÉCNICA
// ═══════════════════════════════════════════
addSection("16. Deuda Técnica y Riesgos");

addSubheader("Riesgo Alto");
addBullet("Motores de AI/ML (fraud detection, demand prediction) tienen lógica placeholder/mock");
addBullet("PHI_ENCRYPTION_KEY debe ser configurada en producción — sin ella, datos PHI no están cifrados");
addBullet("Redis (UPSTASH_REDIS_REST_URL) es requerido para rate limiter, jobs y leader election");
addBullet("Broker webhook URLs necesitan configuración para producción");

doc.moveDown(0.3);
addSubheader("Riesgo Medio");
addBullet("Errores de TypeScript pueden existir — necesita npm run check regular");
addBullet("shared/schema.ts con 4,818 líneas es un archivo muy grande — considerar split");
addBullet("133 módulos en server/lib/ — algunos podrían consolidarse");
addBullet("Algunos tests duplicados entre tests/unit/ y server/tests/");
addBullet("UCM/ subdirectory contiene duplicados de tests");

doc.moveDown(0.3);
addSubheader("Riesgo Bajo");
addBullet("122 dependencias de producción — mantener actualizadas");
addBullet("Monorepo con single package.json puede complicar scaling del equipo");
addBullet("Falta de E2E tests para portales (pharmacy, broker, driver v4)");

// ═══════════════════════════════════════════
// 17. RECOMENDACIONES
// ═══════════════════════════════════════════
doc.addPage();
addSection("17. Recomendaciones");

addSubheader("Inmediatas (Sprint actual)");
addBullet("Ejecutar npm run check y resolver errores de TypeScript");
addBullet("Ejecutar npx vitest run y corregir tests fallidos");
addBullet("Configurar todas las env vars de producción");
addBullet("Verificar deployment Railway end-to-end (API + Worker)");
addBullet("Eliminar directorio UCM/ duplicado");

doc.moveDown(0.3);
addSubheader("Corto Plazo (1-2 Sprints)");
addBullet("Dividir shared/schema.ts en módulos por dominio");
addBullet("Agregar E2E tests para pharmacy portal, broker portal, driver app v4");
addBullet("Implementar integration tests reales con base de datos de prueba");
addBullet("Configurar CI/CD con GitHub Actions");
addBullet("Implementar Stripe integration completa para broker settlements");
addBullet("Push notification testing (FCM) end-to-end");

doc.moveDown(0.3);
addSubheader("Mediano Plazo (1-3 Meses)");
addBullet("Reemplazar lógica mock de AI engines con modelos ML reales");
addBullet("Implementar monitoreo con Sentry para error tracking");
addBullet("Agregar observabilidad (OpenTelemetry, Datadog o similar)");
addBullet("Documentar API con OpenAPI/Swagger");
addBullet("Load testing y performance benchmarks");
addBullet("Security penetration testing profesional");
addBullet("HIPAA compliance audit formal");

doc.moveDown(0.3);
addSubheader("Largo Plazo (3-6 Meses)");
addBullet("Evaluar migración a monorepo con workspaces (Turborepo/Nx)");
addBullet("Microservicios para módulos críticos (billing, dispatch)");
addBullet("CDN para assets estáticos");
addBullet("Database read replicas para queries pesadas de analytics");
addBullet("SOC 2 Type II certification");

// ═══════════════════════════════════════════
// 18. CONCLUSIÓN
// ═══════════════════════════════════════════
addSection("18. Conclusión");

addText("UCM es una plataforma NEMT de escala empresarial con una arquitectura robusta y amplia funcionalidad. Los puntos clave son:", { size: 11 });
doc.moveDown(0.3);

addBullet("Codebase maduro: 346K+ líneas de TypeScript, 195 tablas DB, 133 motores de negocio");
addBullet("Arquitectura sólida: Multi-tenancy estricta, event-driven, separación API/Worker");
addBullet("Funcionalidad completa: Desde dispatch básico hasta EDI billing, fraud detection, y AI");
addBullet("4 portales especializados cubriendo todo el ecosistema NEMT");
addBullet("Seguridad enterprise: HIPAA compliance, PHI encryption, RBAC con 14 roles");
addBullet("Preparado para mobile: Capacitor wrappers para iOS/Android");
addBullet("Internacionalización: 4 idiomas soportados");

doc.moveDown(0.5);
addText("El sistema está funcionalmente completo para un MVP enterprise. Las áreas principales de mejora son: testing end-to-end, integración real de ML engines, y observabilidad en producción.", { size: 11 });

doc.moveDown(1);
addDivider();
addText("Fin del Análisis — Generado el 11 de Marzo, 2026", { size: 9, color: COLORS.muted });
addText("Claude Code (Opus 4.6) — Anthropic", { size: 9, color: COLORS.muted });

// Finalize
doc.end();

output.on("finish", () => {
  console.log("PDF generado: /home/user/UCM_Analisis_Completo.pdf");
});
