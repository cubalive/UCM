import { db } from "./db";
import { eq, and, or, desc, sql, inArray, count, ne, isNull, gte } from "drizzle-orm";
import {
  companies, type Company,
  cities, users, userCityAccess, vehicles, drivers, clinics, patients, trips, auditLog, smsOptOut, invoices,
  citySettings, driverVehicleAssignments, vehicleAssignmentHistory, tripShareTokens, tripSmsLog, tripSeries,
  tripEvents, driverBonusRules, opsAlertLog, clinicAlertLog, clinicHelpRequests,
  routeBatches, driverScores,
  companyCities, clinicCompanies,
  type InsertCity, type InsertUser, type InsertVehicle, type InsertDriver,
  type InsertClinic, type InsertPatient, type InsertTrip, type InsertAuditLog, type InsertInvoice,
  type InsertCitySettings, type InsertDriverVehicleAssignment, type InsertVehicleAssignmentHistory,
  type City, type User, type Vehicle, type Driver, type Clinic, type Patient, type Trip, type AuditLog, type SmsOptOut, type Invoice,
  type CitySettings, type DriverVehicleAssignment, type VehicleAssignmentHistory,
  type TripShareToken, type InsertTripShareToken, type TripSmsLog, type InsertTripSmsLog,
  type TripSeries, type InsertTripSeries,
  type TripEvent, type InsertTripEvent, type DriverBonusRule, type InsertDriverBonusRule,
  type OpsAlertLog, type InsertOpsAlertLog, type ClinicAlertLog, type InsertClinicAlertLog,
  type ClinicHelpRequest, type InsertClinicHelpRequest,
  type RouteBatch, type InsertRouteBatch, type DriverScore, type InsertDriverScore,
  recurringSchedules, type RecurringSchedule, type InsertRecurringSchedule,
  clinicTariffs, type ClinicTariff, type InsertClinicTariff,
  tripBilling, type TripBilling, type InsertTripBilling,
  clinicInvoicesMonthly, type ClinicInvoiceMonthly, type InsertClinicInvoiceMonthly,
  clinicInvoiceItems, type ClinicInvoiceItem, type InsertClinicInvoiceItem,
  tripSignatures, type TripSignature, type InsertTripSignature,
  clinicBillingSettings, type ClinicBillingSettingsType, type InsertClinicBillingSettings,
  billingCycleInvoices, type BillingCycleInvoice, type InsertBillingCycleInvoice,
  billingCycleInvoiceItems, type BillingCycleInvoiceItem, type InsertBillingCycleInvoiceItem,
  invoicePayments, type InvoicePayment, type InsertInvoicePayment,
  invoiceSequences,
  aiEngineSnapshots, type AiEngineSnapshot, type InsertAiEngineSnapshot,
  companyStripeAccounts, type CompanyStripeAccount, type InsertCompanyStripeAccount,
  stripeWebhookEvents, type StripeWebhookEvent,
} from "@shared/schema";

export interface IStorage {
  getCompanies(): Promise<Company[]>;
  getCompany(id: number): Promise<Company | undefined>;
  updateCompany(id: number, data: Partial<Company>): Promise<Company | undefined>;
  deleteCompany(id: number): Promise<void>;
  hasActiveTripsForCompany(companyId: number): Promise<boolean>;

  getCities(): Promise<City[]>;
  getCity(id: number): Promise<City | undefined>;
  createCity(data: InsertCity): Promise<City>;
  updateCity(id: number, data: Partial<City>): Promise<City | undefined>;

  getUsers(): Promise<Omit<User, "password">[]>;
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByClinicId(clinicId: number): Promise<User | undefined>;
  getUserByDriverId(driverId: number): Promise<User | undefined>;
  createUser(data: InsertUser): Promise<Omit<User, "password">>;
  getUserCityAccess(userId: number): Promise<number[]>;
  setUserCityAccess(userId: number, cityIds: number[]): Promise<void>;

  getVehicles(cityId?: number): Promise<Vehicle[]>;
  getVehicle(id: number): Promise<Vehicle | undefined>;
  createVehicle(data: InsertVehicle): Promise<Vehicle>;
  updateVehicle(id: number, data: Partial<Vehicle>): Promise<Vehicle | undefined>;

  getDrivers(cityId?: number): Promise<Driver[]>;
  getDriver(id: number): Promise<Driver | undefined>;
  createDriver(data: InsertDriver): Promise<Driver>;
  updateDriver(id: number, data: Partial<Driver>): Promise<Driver | undefined>;
  getDriverByVehicleId(vehicleId: number, excludeDriverId?: number): Promise<Driver | undefined>;

  getClinics(cityId?: number): Promise<Clinic[]>;
  getClinic(id: number): Promise<Clinic | undefined>;
  createClinic(data: InsertClinic): Promise<Clinic>;
  updateClinic(id: number, data: Partial<Clinic>): Promise<Clinic | undefined>;

  getPatients(cityId?: number): Promise<Patient[]>;
  getPatient(id: number): Promise<Patient | undefined>;
  createPatient(data: InsertPatient): Promise<Patient>;
  updatePatient(id: number, data: Partial<Patient>): Promise<Patient | undefined>;

  getTrips(cityId?: number, limit?: number): Promise<Trip[]>;
  getTrip(id: number): Promise<Trip | undefined>;
  createTrip(data: InsertTrip): Promise<Trip>;
  updateTrip(id: number, data: Partial<Trip>): Promise<Trip | undefined>;
  updateTripStatus(id: number, status: string): Promise<Trip | undefined>;
  getUnassignedTrips(cityId: number): Promise<Trip[]>;
  getActiveEnRouteTrips(): Promise<Trip[]>;
  getActiveTripsForDriver(driverId: number): Promise<Trip[]>;
  getTripsByDriverAndDate(driverId: number, date: string): Promise<Trip[]>;

  getAuditLogs(cityId?: number): Promise<AuditLog[]>;
  createAuditLog(data: InsertAuditLog): Promise<AuditLog>;

  getStats(cityId?: number): Promise<Record<string, number>>;
  getTripStatusSummary(cityId?: number): Promise<Record<string, number>>;

  getInvoices(clinicId?: number): Promise<Invoice[]>;
  getInvoice(id: number): Promise<Invoice | undefined>;
  getInvoiceByTripId(tripId: number): Promise<Invoice | undefined>;
  createInvoice(data: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: number, data: Partial<InsertInvoice>): Promise<Invoice>;
  getWeeklyInvoices(clinicId?: number): Promise<Invoice[]>;
  getUninvoicedCompletedTrips(clinicId: number, startDate: string, endDate: string, companyId?: number | null): Promise<Trip[]>;
  linkTripsToInvoice(tripIds: number[], invoiceId: number): Promise<void>;
  getTripsByInvoiceId(invoiceId: number): Promise<Trip[]>;

  isPhoneOptedOut(phone: string): Promise<boolean>;
  setPhoneOptOut(phone: string, optedOut: boolean): Promise<void>;

  getCitySettings(cityId: number): Promise<CitySettings | undefined>;
  getAllCitySettings(): Promise<CitySettings[]>;
  upsertCitySettings(data: InsertCitySettings): Promise<CitySettings>;

  getDriverVehicleAssignments(cityId: number, date: string): Promise<DriverVehicleAssignment[]>;
  getDriverVehicleAssignment(driverId: number, date: string): Promise<DriverVehicleAssignment | undefined>;
  createDriverVehicleAssignment(data: InsertDriverVehicleAssignment): Promise<DriverVehicleAssignment>;
  updateDriverVehicleAssignment(id: number, data: Partial<DriverVehicleAssignment>): Promise<DriverVehicleAssignment | undefined>;
  getYesterdayAssignment(driverId: number, yesterday: string): Promise<DriverVehicleAssignment | undefined>;

  getVehicleAssignmentHistory(driverId: number): Promise<VehicleAssignmentHistory[]>;
  createVehicleAssignmentHistory(data: InsertVehicleAssignmentHistory): Promise<VehicleAssignmentHistory>;
  closeVehicleAssignmentHistory(driverId: number, vehicleId: number): Promise<void>;

  createTripShareToken(data: InsertTripShareToken): Promise<TripShareToken>;
  getActiveTokenForTrip(tripId: number): Promise<TripShareToken | undefined>;
  getTokenByValue(token: string): Promise<TripShareToken | undefined>;
  revokeTokensForTrip(tripId: number): Promise<void>;

  createTripSmsLog(data: InsertTripSmsLog): Promise<TripSmsLog>;
  hasSmsBeenSent(tripId: number, kind: string): Promise<boolean>;

  getActiveDriverIdsForClinic(cityId: number, clinicId: number): Promise<number[]>;
  getActiveDriverIdForPatient(patientId: number): Promise<number | null>;
  getActiveTripsForClinic(cityId: number, clinicId: number): Promise<Trip[]>;
  getActiveTripForPatient(patientId: number): Promise<Trip | undefined>;

  getTripSeriesList(cityId?: number): Promise<TripSeries[]>;
  getTripSeriesById(id: number): Promise<TripSeries | undefined>;
  createTripSeries(data: InsertTripSeries): Promise<TripSeries>;
  updateTripSeries(id: number, data: Partial<TripSeries>): Promise<TripSeries | undefined>;
  getTripsBySeriesId(seriesId: number): Promise<Trip[]>;

  // Archive management
  getArchivedClinics(): Promise<Clinic[]>;
  getArchivedDrivers(): Promise<Driver[]>;
  getArchivedPatients(): Promise<Patient[]>;
  getArchivedUsers(): Promise<Omit<User, "password">[]>;
  getArchivedTrips(): Promise<Trip[]>;
  getArchivedVehicles(): Promise<Vehicle[]>;

  // Active trip guard queries
  hasActiveTripsForClinic(clinicId: number): Promise<boolean>;
  hasActiveTripsForDriver(driverId: number): Promise<boolean>;
  hasActiveTripsForPatient(patientId: number): Promise<boolean>;
  hasActiveTripsForVehicle(vehicleId: number): Promise<boolean>;

  // Permanent delete
  deleteClinic(id: number): Promise<void>;
  deleteDriver(id: number): Promise<void>;
  deletePatient(id: number): Promise<void>;
  deleteUser(id: number): Promise<void>;
  deleteTrip(id: number): Promise<void>;
  deleteVehicle(id: number): Promise<void>;

  // Update user (for admin password reset)
  updateUser(id: number, data: Partial<User>): Promise<Omit<User, "password"> | undefined>;

  // Company-City relationships
  getCompanyCities(companyId: number): Promise<number[]>;
  setCompanyCities(companyId: number, cityIds: number[]): Promise<void>;
  getCitiesForCompany(companyId: number): Promise<City[]>;

  // Clinic-Company relationships
  getClinicCompanies(clinicId: number): Promise<number[]>;
  setClinicCompanies(clinicId: number, companyIds: number[]): Promise<void>;
  getCompaniesForClinic(clinicId: number): Promise<Company[]>;

  // Working city persistence
  setUserWorkingCity(userId: number, cityId: number | null, scope?: string): Promise<void>;

  // Trip events
  getTripEvents(tripId: number): Promise<TripEvent[]>;
  createTripEvent(data: InsertTripEvent): Promise<TripEvent>;
  getTripEventsByDateRange(cityId: number, startDate: string, endDate: string): Promise<(TripEvent & { trip: Trip })[]>;

  // Driver bonus rules
  getDriverBonusRule(cityId: number): Promise<DriverBonusRule | undefined>;
  getAllDriverBonusRules(): Promise<DriverBonusRule[]>;
  upsertDriverBonusRule(data: Partial<DriverBonusRule> & { cityId: number }): Promise<DriverBonusRule>;

  getActiveCities(): Promise<City[]>;
  getTripsForCityAndDate(cityId: number, date: string): Promise<Trip[]>;
  getTripsForClinicToday(clinicId: number, date: string): Promise<Trip[]>;

  createOpsAlertLog(data: InsertOpsAlertLog): Promise<OpsAlertLog>;
  getRecentOpsAlerts(cityId: number, date: string, minutesBack: number): Promise<OpsAlertLog[]>;
  getOpsAlertsByCityAndDate(cityId: number, date: string): Promise<OpsAlertLog[]>;

  createClinicAlertLog(data: InsertClinicAlertLog): Promise<ClinicAlertLog>;
  getRecentClinicAlerts(clinicId: number, minutesBack: number): Promise<ClinicAlertLog[]>;
  getClinicAlertsByClinicId(clinicId: number, limit?: number): Promise<ClinicAlertLog[]>;

  createClinicHelpRequest(data: InsertClinicHelpRequest): Promise<ClinicHelpRequest>;
  getClinicHelpRequests(clinicId?: number): Promise<ClinicHelpRequest[]>;
  resolveClinicHelpRequest(id: number, userId: number): Promise<ClinicHelpRequest | undefined>;

  getRecurringSchedulesByPatient(patientId: number): Promise<RecurringSchedule[]>;
  getRecurringSchedulesByCity(cityId: number): Promise<RecurringSchedule[]>;
  getActiveRecurringSchedules(): Promise<RecurringSchedule[]>;
  createRecurringSchedule(data: InsertRecurringSchedule): Promise<RecurringSchedule>;
  updateRecurringSchedule(id: number, data: Partial<RecurringSchedule>): Promise<RecurringSchedule | undefined>;
  deleteRecurringSchedule(id: number): Promise<void>;

  getClinicTariffs(clinicId: number): Promise<ClinicTariff[]>;
  getClinicTariff(id: number): Promise<ClinicTariff | undefined>;
  getActiveTariff(clinicId: number, cityId?: number | null): Promise<ClinicTariff | undefined>;
  createClinicTariff(data: InsertClinicTariff): Promise<ClinicTariff>;
  updateClinicTariff(id: number, data: Partial<ClinicTariff>): Promise<ClinicTariff | undefined>;

  getTripBilling(tripId: number): Promise<TripBilling | undefined>;
  createTripBilling(data: InsertTripBilling): Promise<TripBilling>;
  getTripBillingsByClinic(clinicId: number, month?: string): Promise<TripBilling[]>;

  getClinicInvoicesMonthly(clinicId?: number): Promise<ClinicInvoiceMonthly[]>;
  getClinicInvoiceMonthly(id: number): Promise<ClinicInvoiceMonthly | undefined>;
  createClinicInvoiceMonthly(data: InsertClinicInvoiceMonthly): Promise<ClinicInvoiceMonthly>;
  updateClinicInvoiceMonthly(id: number, data: Partial<ClinicInvoiceMonthly>): Promise<ClinicInvoiceMonthly | undefined>;

  createClinicInvoiceItem(data: InsertClinicInvoiceItem): Promise<ClinicInvoiceItem>;
  getClinicInvoiceItems(invoiceId: number): Promise<ClinicInvoiceItem[]>;

  getTripSignature(tripId: number): Promise<TripSignature | undefined>;
  upsertTripSignature(tripId: number, data: Partial<InsertTripSignature>): Promise<TripSignature>;

  getClinicBillingSettings(clinicId: number): Promise<ClinicBillingSettingsType | undefined>;
  upsertClinicBillingSettings(data: InsertClinicBillingSettings): Promise<ClinicBillingSettingsType>;

  getBillingCycleInvoice(id: number): Promise<BillingCycleInvoice | undefined>;
  getBillingCycleInvoices(clinicId: number, status?: string, from?: string, to?: string): Promise<BillingCycleInvoice[]>;
  findBillingCycleInvoice(clinicId: number, periodStart: string, periodEnd: string): Promise<BillingCycleInvoice | undefined>;
  createBillingCycleInvoice(data: InsertBillingCycleInvoice): Promise<BillingCycleInvoice>;
  updateBillingCycleInvoice(id: number, data: Partial<BillingCycleInvoice>): Promise<BillingCycleInvoice | undefined>;

  getBillingCycleInvoiceItems(invoiceId: number): Promise<BillingCycleInvoiceItem[]>;
  createBillingCycleInvoiceItem(data: InsertBillingCycleInvoiceItem): Promise<BillingCycleInvoiceItem>;

  getEligibleTripsForBilling(clinicId: number, periodStart: string, periodEnd: string): Promise<Trip[]>;
  getTripIdsAlreadyBilled(clinicId: number): Promise<number[]>;

  createInvoicePayment(data: InsertInvoicePayment): Promise<InvoicePayment>;
  getInvoicePayments(invoiceId: number): Promise<InvoicePayment[]>;
  findPaymentByReference(reference: string): Promise<InvoicePayment | undefined>;
  findPaymentByStripePI(stripePaymentIntentId: string): Promise<InvoicePayment | undefined>;
  nextInvoiceNumber(): Promise<string>;
  getBillingCycleInvoicesByPaymentStatus(statuses: string[], clinicId?: number): Promise<BillingCycleInvoice[]>;

  createAiEngineSnapshot(data: InsertAiEngineSnapshot): Promise<AiEngineSnapshot>;
  getLatestAiEngineSnapshot(): Promise<AiEngineSnapshot | undefined>;
  getRecentTripsUpdatedSince(since: Date): Promise<Trip[]>;
  getRecentDriversUpdatedSince(since: Date): Promise<Driver[]>;

  getCompanyStripeAccount(companyId: number): Promise<CompanyStripeAccount | undefined>;
  upsertCompanyStripeAccount(data: InsertCompanyStripeAccount): Promise<CompanyStripeAccount>;
  updateCompanyStripeAccount(companyId: number, data: Partial<CompanyStripeAccount>): Promise<CompanyStripeAccount>;
  insertStripeWebhookEvent(stripeEventId: string, type: string): Promise<{ inserted: boolean }>;
  updateStripeWebhookEvent(stripeEventId: string, status: string, error?: string | null): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getCompanies(): Promise<Company[]> {
    return db.select().from(companies).orderBy(companies.name);
  }

  async getCompany(id: number): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }

  async updateCompany(id: number, data: Partial<Company>): Promise<Company | undefined> {
    const { id: _id, ...updateData } = data as any;
    const [company] = await db.update(companies).set(updateData).where(eq(companies.id, id)).returning();
    return company;
  }

  async deleteCompany(id: number): Promise<void> {
    await db.delete(companies).where(eq(companies.id, id));
  }

  async hasActiveTripsForCompany(companyId: number): Promise<boolean> {
    const activeStatuses = ["SCHEDULED", "ASSIGNED", "EN_ROUTE_PICKUP", "AT_PICKUP", "EN_ROUTE_DROPOFF", "AT_DROPOFF"];
    const [result] = await db.select({ count: count() }).from(trips).where(
      and(
        eq(trips.companyId, companyId),
        inArray(trips.status, activeStatuses as any),
        isNull(trips.deletedAt),
      )
    );
    return (result?.count ?? 0) > 0;
  }

  async getCities(): Promise<City[]> {
    return db.select().from(cities).orderBy(cities.name);
  }

  async getCity(id: number): Promise<City | undefined> {
    const [city] = await db.select().from(cities).where(eq(cities.id, id));
    return city;
  }

  async createCity(data: InsertCity): Promise<City> {
    const [city] = await db.insert(cities).values(data).returning();
    return city;
  }

  async updateCity(id: number, data: Partial<City>): Promise<City | undefined> {
    const { id: _id, ...updateData } = data as any;
    const [city] = await db.update(cities).set(updateData).where(eq(cities.id, id)).returning();
    return city;
  }

  async getUsers(): Promise<Omit<User, "password">[]> {
    const rows = await db.select().from(users).where(
      and(eq(users.active, true), isNull(users.deletedAt))
    ).orderBy(users.firstName);
    return rows.map(({ password, ...rest }) => rest) as any;
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByClinicId(clinicId: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.clinicId, clinicId));
    return user;
  }

  async getUserByDriverId(driverId: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.driverId, driverId));
    return user;
  }

  async createUser(data: InsertUser): Promise<Omit<User, "password">> {
    const [user] = await db.insert(users).values(data).returning();
    const { password, ...rest } = user;
    return rest as any;
  }

  async getUserCityAccess(userId: number): Promise<number[]> {
    const rows = await db.select({ cityId: userCityAccess.cityId }).from(userCityAccess).where(eq(userCityAccess.userId, userId));
    return rows.map((r) => r.cityId);
  }

  async setUserCityAccess(userId: number, cityIds: number[]): Promise<void> {
    await db.delete(userCityAccess).where(eq(userCityAccess.userId, userId));
    if (cityIds.length > 0) {
      await db.insert(userCityAccess).values(cityIds.map((cityId) => ({ userId, cityId })));
    }
  }

  async getVehicles(cityId?: number): Promise<Vehicle[]> {
    if (cityId) {
      return db.select().from(vehicles).where(and(eq(vehicles.cityId, cityId), eq(vehicles.active, true), isNull(vehicles.deletedAt))).orderBy(vehicles.name);
    }
    return db.select().from(vehicles).where(and(eq(vehicles.active, true), isNull(vehicles.deletedAt))).orderBy(vehicles.name);
  }

  async getVehicle(id: number): Promise<Vehicle | undefined> {
    const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    return vehicle;
  }

  async createVehicle(data: InsertVehicle): Promise<Vehicle> {
    const [vehicle] = await db.insert(vehicles).values(data).returning();
    return vehicle;
  }

  async updateVehicle(id: number, data: Partial<Vehicle>): Promise<Vehicle | undefined> {
    const { id: _id, publicId: _pid, createdAt: _ca, ...updateData } = data as any;
    if (updateData.licensePlate) {
      updateData.licensePlate = updateData.licensePlate.trim().toUpperCase();
    }
    const [vehicle] = await db.update(vehicles).set(updateData).where(eq(vehicles.id, id)).returning();
    return vehicle;
  }

  async getDrivers(cityId?: number): Promise<Driver[]> {
    if (cityId) {
      return db.select().from(drivers).where(
        and(eq(drivers.cityId, cityId), eq(drivers.active, true), isNull(drivers.deletedAt))
      ).orderBy(drivers.firstName);
    }
    return db.select().from(drivers).where(
      and(eq(drivers.active, true), isNull(drivers.deletedAt))
    ).orderBy(drivers.firstName);
  }

  async getDriver(id: number): Promise<Driver | undefined> {
    const [driver] = await db.select().from(drivers).where(eq(drivers.id, id));
    return driver;
  }

  async createDriver(data: InsertDriver): Promise<Driver> {
    const [driver] = await db.insert(drivers).values(data).returning();
    return driver;
  }

  async updateDriver(id: number, data: Partial<Driver>): Promise<Driver | undefined> {
    const { id: _id, ...updateData } = data as any;
    if (updateData.licenseNumber) {
      updateData.licenseNumber = updateData.licenseNumber.trim().toUpperCase();
    }
    const [driver] = await db.update(drivers).set(updateData).where(eq(drivers.id, id)).returning();
    return driver;
  }

  async getDriverByVehicleId(vehicleId: number, excludeDriverId?: number): Promise<Driver | undefined> {
    const conditions = [
      eq(drivers.vehicleId, vehicleId),
      eq(drivers.status, "ACTIVE"),
    ];
    if (excludeDriverId) {
      conditions.push(ne(drivers.id, excludeDriverId) as any);
    }
    const [driver] = await db.select().from(drivers).where(and(...conditions));
    return driver;
  }

  async getClinics(cityId?: number): Promise<Clinic[]> {
    if (cityId) {
      return db.select().from(clinics).where(
        and(eq(clinics.cityId, cityId), eq(clinics.active, true), isNull(clinics.deletedAt))
      ).orderBy(clinics.name);
    }
    return db.select().from(clinics).where(
      and(eq(clinics.active, true), isNull(clinics.deletedAt))
    ).orderBy(clinics.name);
  }

  async getClinic(id: number): Promise<Clinic | undefined> {
    const [clinic] = await db.select().from(clinics).where(eq(clinics.id, id));
    return clinic;
  }

  async createClinic(data: InsertClinic): Promise<Clinic> {
    const [clinic] = await db.insert(clinics).values(data).returning();
    return clinic;
  }

  async updateClinic(id: number, data: Partial<Clinic>): Promise<Clinic | undefined> {
    const { id: _id, ...updateData } = data as any;
    const [clinic] = await db.update(clinics).set(updateData).where(eq(clinics.id, id)).returning();
    return clinic;
  }

  async getPatients(cityId?: number): Promise<Patient[]> {
    if (cityId) {
      return db.select().from(patients).where(
        and(eq(patients.cityId, cityId), eq(patients.active, true), isNull(patients.deletedAt))
      ).orderBy(patients.firstName);
    }
    return db.select().from(patients).where(
      and(eq(patients.active, true), isNull(patients.deletedAt))
    ).orderBy(patients.firstName);
  }

  async getPatient(id: number): Promise<Patient | undefined> {
    const [patient] = await db.select().from(patients).where(eq(patients.id, id));
    return patient;
  }

  async createPatient(data: InsertPatient): Promise<Patient> {
    const [patient] = await db.insert(patients).values(data).returning();
    return patient;
  }

  async updatePatient(id: number, data: Partial<Patient>): Promise<Patient | undefined> {
    const { id: _id, ...updateData } = data as any;
    const [patient] = await db.update(patients).set(updateData).where(eq(patients.id, id)).returning();
    return patient;
  }

  async getTrips(cityId?: number, limit?: number): Promise<Trip[]> {
    let query = db.select().from(trips);
    if (cityId) {
      query = query.where(and(eq(trips.cityId, cityId), isNull(trips.deletedAt))) as any;
    } else {
      query = query.where(isNull(trips.deletedAt)) as any;
    }
    query = query.orderBy(desc(trips.createdAt)) as any;
    if (limit) {
      query = query.limit(limit) as any;
    }
    return query;
  }

  async getTrip(id: number): Promise<Trip | undefined> {
    const [trip] = await db.select().from(trips).where(eq(trips.id, id));
    return trip;
  }

  async createTrip(data: InsertTrip): Promise<Trip> {
    const [trip] = await db.insert(trips).values(data).returning();
    return trip;
  }

  async updateTrip(id: number, data: Partial<Trip>): Promise<Trip | undefined> {
    const { id: _id, ...updateData } = data as any;
    updateData.updatedAt = new Date();
    const [trip] = await db.update(trips).set(updateData).where(eq(trips.id, id)).returning();
    return trip;
  }

  async updateTripStatus(id: number, status: string): Promise<Trip | undefined> {
    const [trip] = await db.update(trips).set({ status: status as any, updatedAt: new Date() }).where(eq(trips.id, id)).returning();
    return trip;
  }

  async getUnassignedTrips(cityId: number): Promise<Trip[]> {
    return db.select().from(trips).where(
      and(
        eq(trips.cityId, cityId),
        eq(trips.status, "SCHEDULED"),
        isNull(trips.driverId),
      )
    ).orderBy(trips.scheduledDate, trips.scheduledTime);
  }

  async getActiveEnRouteTrips(): Promise<Trip[]> {
    return db.select().from(trips).where(
      and(
        inArray(trips.status, ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"]),
        sql`${trips.driverId} IS NOT NULL`,
        sql`${trips.pickupLat} IS NOT NULL`,
        sql`${trips.pickupLng} IS NOT NULL`,
        isNull(trips.deletedAt),
      )
    );
  }

  async getActiveTripsForDriver(driverId: number): Promise<Trip[]> {
    return db.select().from(trips).where(
      and(
        eq(trips.driverId, driverId),
        inArray(trips.status, ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"]),
        isNull(trips.deletedAt),
      )
    );
  }

  async getTripsByDriverAndDate(driverId: number, date: string): Promise<Trip[]> {
    return db.select().from(trips).where(
      and(
        eq(trips.driverId, driverId),
        eq(trips.scheduledDate, date),
        inArray(trips.status, ["SCHEDULED", "ASSIGNED", "IN_PROGRESS"]),
        isNull(trips.deletedAt),
      )
    );
  }

  async getAuditLogs(cityId?: number): Promise<AuditLog[]> {
    if (cityId) {
      return db.select().from(auditLog).where(eq(auditLog.cityId, cityId)).orderBy(desc(auditLog.createdAt)).limit(100);
    }
    return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(100);
  }

  async createAuditLog(data: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db.insert(auditLog).values(data).returning();
    return log;
  }

  async getStats(cityId?: number): Promise<Record<string, number>> {
    const tripsQ = cityId
      ? db.select({ value: count() }).from(trips).where(eq(trips.cityId, cityId))
      : db.select({ value: count() }).from(trips);
    const patientsQ = cityId
      ? db.select({ value: count() }).from(patients).where(eq(patients.cityId, cityId))
      : db.select({ value: count() }).from(patients);
    const driversQ = cityId
      ? db.select({ value: count() }).from(drivers).where(eq(drivers.cityId, cityId))
      : db.select({ value: count() }).from(drivers);
    const vehiclesQ = cityId
      ? db.select({ value: count() }).from(vehicles).where(eq(vehicles.cityId, cityId))
      : db.select({ value: count() }).from(vehicles);
    const clinicsQ = cityId
      ? db.select({ value: count() }).from(clinics).where(eq(clinics.cityId, cityId))
      : db.select({ value: count() }).from(clinics);
    const usersQ = db.select({ value: count() }).from(users);

    const [t, p, d, v, c, u] = await Promise.all([tripsQ, patientsQ, driversQ, vehiclesQ, clinicsQ, usersQ]);

    return {
      trips: Number(t[0]?.value || 0),
      patients: Number(p[0]?.value || 0),
      drivers: Number(d[0]?.value || 0),
      vehicles: Number(v[0]?.value || 0),
      clinics: Number(c[0]?.value || 0),
      users: Number(u[0]?.value || 0),
    };
  }

  async getTripStatusSummary(cityId?: number): Promise<Record<string, number>> {
    const q = cityId
      ? db.select({ status: trips.status, value: count() }).from(trips).where(eq(trips.cityId, cityId)).groupBy(trips.status)
      : db.select({ status: trips.status, value: count() }).from(trips).groupBy(trips.status);
    const rows = await q;

    const summary: Record<string, number> = {};
    for (const row of rows) {
      summary[row.status] = Number(row.value);
    }
    return summary;
  }
  async getInvoices(clinicId?: number): Promise<Invoice[]> {
    if (clinicId) {
      return db.select().from(invoices).where(eq(invoices.clinicId, clinicId)).orderBy(desc(invoices.createdAt));
    }
    return db.select().from(invoices).orderBy(desc(invoices.createdAt));
  }

  async getInvoice(id: number): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice;
  }

  async createInvoice(data: InsertInvoice): Promise<Invoice> {
    const [invoice] = await db.insert(invoices).values(data).returning();
    return invoice;
  }

  async getInvoiceByTripId(tripId: number): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.tripId, tripId));
    return invoice;
  }

  async updateInvoice(id: number, data: Partial<InsertInvoice>): Promise<Invoice> {
    const [invoice] = await db.update(invoices).set(data).where(eq(invoices.id, id)).returning();
    return invoice;
  }

  async getWeeklyInvoices(clinicId?: number): Promise<Invoice[]> {
    if (clinicId) {
      return db.select().from(invoices).where(and(isNull(invoices.tripId), eq(invoices.clinicId, clinicId))).orderBy(desc(invoices.createdAt));
    }
    return db.select().from(invoices).where(isNull(invoices.tripId)).orderBy(desc(invoices.createdAt));
  }

  async getUninvoicedCompletedTrips(clinicId: number, startDate: string, endDate: string, companyId?: number | null): Promise<Trip[]> {
    const conditions = [
      eq(trips.status, "COMPLETED"),
      eq(trips.clinicId, clinicId),
      isNull(trips.invoiceId),
      isNull(trips.deletedAt),
      sql`${trips.scheduledDate} >= ${startDate}`,
      sql`${trips.scheduledDate} <= ${endDate}`,
    ];
    if (companyId) {
      conditions.push(eq(trips.companyId, companyId));
    }
    return db.select().from(trips).where(and(...conditions)).orderBy(trips.scheduledDate);
  }

  async linkTripsToInvoice(tripIds: number[], invoiceId: number): Promise<void> {
    if (tripIds.length === 0) return;
    await db.update(trips).set({ invoiceId }).where(inArray(trips.id, tripIds));
  }

  async getTripsByInvoiceId(invoiceId: number): Promise<Trip[]> {
    return db.select().from(trips).where(eq(trips.invoiceId, invoiceId)).orderBy(trips.scheduledDate);
  }

  async isPhoneOptedOut(phone: string): Promise<boolean> {
    const [row] = await db.select().from(smsOptOut).where(eq(smsOptOut.phone, phone));
    return row?.optedOut === true;
  }

  async setPhoneOptOut(phone: string, optedOut: boolean): Promise<void> {
    const [existing] = await db.select().from(smsOptOut).where(eq(smsOptOut.phone, phone));
    if (existing) {
      await db.update(smsOptOut).set({ optedOut, updatedAt: new Date() }).where(eq(smsOptOut.phone, phone));
    } else {
      await db.insert(smsOptOut).values({ phone, optedOut, updatedAt: new Date() });
    }
  }

  async getCitySettings(cityId: number): Promise<CitySettings | undefined> {
    const [settings] = await db.select().from(citySettings).where(eq(citySettings.cityId, cityId));
    return settings;
  }

  async getAllCitySettings(): Promise<CitySettings[]> {
    return db.select().from(citySettings);
  }

  async upsertCitySettings(data: InsertCitySettings): Promise<CitySettings> {
    const existing = await this.getCitySettings(data.cityId);
    if (existing) {
      const [updated] = await db.update(citySettings)
        .set(data)
        .where(eq(citySettings.cityId, data.cityId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(citySettings).values(data).returning();
    return created;
  }

  async getDriverVehicleAssignments(cityId: number, date: string): Promise<DriverVehicleAssignment[]> {
    return db.select().from(driverVehicleAssignments)
      .where(and(
        eq(driverVehicleAssignments.cityId, cityId),
        eq(driverVehicleAssignments.date, date),
      ))
      .orderBy(driverVehicleAssignments.driverId);
  }

  async getDriverVehicleAssignment(driverId: number, date: string): Promise<DriverVehicleAssignment | undefined> {
    const [row] = await db.select().from(driverVehicleAssignments)
      .where(and(
        eq(driverVehicleAssignments.driverId, driverId),
        eq(driverVehicleAssignments.date, date),
      ));
    return row;
  }

  async createDriverVehicleAssignment(data: InsertDriverVehicleAssignment): Promise<DriverVehicleAssignment> {
    const [row] = await db.insert(driverVehicleAssignments).values(data).returning();
    return row;
  }

  async updateDriverVehicleAssignment(id: number, data: Partial<DriverVehicleAssignment>): Promise<DriverVehicleAssignment | undefined> {
    const { id: _id, ...updateData } = data as any;
    const [row] = await db.update(driverVehicleAssignments)
      .set(updateData)
      .where(eq(driverVehicleAssignments.id, id))
      .returning();
    return row;
  }

  async getYesterdayAssignment(driverId: number, yesterday: string): Promise<DriverVehicleAssignment | undefined> {
    const [row] = await db.select().from(driverVehicleAssignments)
      .where(and(
        eq(driverVehicleAssignments.driverId, driverId),
        eq(driverVehicleAssignments.date, yesterday),
      ));
    return row;
  }

  async getVehicleAssignmentHistory(driverId: number): Promise<VehicleAssignmentHistory[]> {
    return db.select().from(vehicleAssignmentHistory)
      .where(eq(vehicleAssignmentHistory.driverId, driverId))
      .orderBy(desc(vehicleAssignmentHistory.assignedAt));
  }

  async createVehicleAssignmentHistory(data: InsertVehicleAssignmentHistory): Promise<VehicleAssignmentHistory> {
    const [row] = await db.insert(vehicleAssignmentHistory).values(data).returning();
    return row;
  }

  async closeVehicleAssignmentHistory(driverId: number, vehicleId: number): Promise<void> {
    await db.update(vehicleAssignmentHistory)
      .set({ unassignedAt: new Date() })
      .where(and(
        eq(vehicleAssignmentHistory.driverId, driverId),
        eq(vehicleAssignmentHistory.vehicleId, vehicleId),
        isNull(vehicleAssignmentHistory.unassignedAt),
      ));
  }

  async createTripShareToken(data: InsertTripShareToken): Promise<TripShareToken> {
    const [row] = await db.insert(tripShareTokens).values(data).returning();
    return row;
  }

  async getActiveTokenForTrip(tripId: number): Promise<TripShareToken | undefined> {
    const [row] = await db.select().from(tripShareTokens)
      .where(and(
        eq(tripShareTokens.tripId, tripId),
        eq(tripShareTokens.revoked, false),
        sql`${tripShareTokens.expiresAt} > NOW()`,
      ))
      .orderBy(desc(tripShareTokens.createdAt))
      .limit(1);
    return row;
  }

  async getTokenByValue(token: string): Promise<TripShareToken | undefined> {
    const [row] = await db.select().from(tripShareTokens)
      .where(eq(tripShareTokens.token, token));
    return row;
  }

  async revokeTokensForTrip(tripId: number): Promise<void> {
    await db.update(tripShareTokens)
      .set({ revoked: true })
      .where(and(
        eq(tripShareTokens.tripId, tripId),
        eq(tripShareTokens.revoked, false),
      ));
  }

  async createTripSmsLog(data: InsertTripSmsLog): Promise<TripSmsLog> {
    const [row] = await db.insert(tripSmsLog).values(data).onConflictDoNothing().returning();
    if (!row) {
      const [existing] = await db.select().from(tripSmsLog)
        .where(and(eq(tripSmsLog.tripId, data.tripId), eq(tripSmsLog.kind, data.kind)));
      return existing;
    }
    return row;
  }

  async hasSmsBeenSent(tripId: number, kind: string): Promise<boolean> {
    const [row] = await db.select({ cnt: count() }).from(tripSmsLog)
      .where(and(
        eq(tripSmsLog.tripId, tripId),
        eq(tripSmsLog.kind, kind),
      ));
    return (row?.cnt ?? 0) > 0;
  }

  async getActiveDriverIdsForClinic(cityId: number, clinicId: number): Promise<number[]> {
    const activeStatuses: ("ASSIGNED" | "EN_ROUTE_TO_PICKUP" | "ARRIVED_PICKUP" | "PICKED_UP" | "EN_ROUTE_TO_DROPOFF" | "ARRIVED_DROPOFF" | "IN_PROGRESS")[] = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];
    const rows = await db
      .selectDistinct({ driverId: trips.driverId })
      .from(trips)
      .where(
        and(
          eq(trips.cityId, cityId),
          eq(trips.clinicId, clinicId),
          inArray(trips.status, activeStatuses),
          sql`${trips.driverId} IS NOT NULL`,
          isNull(trips.deletedAt),
        )
      );
    return rows.map((r) => r.driverId!).filter(Boolean);
  }

  async getActiveDriverIdForPatient(patientId: number): Promise<number | null> {
    const [row] = await db
      .select({ driverId: trips.driverId })
      .from(trips)
      .where(
        and(
          eq(trips.patientId, patientId),
          or(
            eq(trips.status, "ASSIGNED"),
            eq(trips.status, "IN_PROGRESS"),
          ),
          sql`${trips.driverId} IS NOT NULL`,
        )
      )
      .orderBy(desc(trips.scheduledDate))
      .limit(1);
    return row?.driverId ?? null;
  }

  async getActiveTripsForClinic(cityId: number, clinicId: number): Promise<Trip[]> {
    return db
      .select()
      .from(trips)
      .where(
        and(
          eq(trips.cityId, cityId),
          eq(trips.clinicId, clinicId),
          or(
            eq(trips.status, "ASSIGNED"),
            eq(trips.status, "IN_PROGRESS"),
          ),
        )
      )
      .orderBy(desc(trips.scheduledDate));
  }

  async getActiveTripForPatient(patientId: number): Promise<Trip | undefined> {
    const [row] = await db
      .select()
      .from(trips)
      .where(
        and(
          eq(trips.patientId, patientId),
          or(
            eq(trips.status, "ASSIGNED"),
            eq(trips.status, "IN_PROGRESS"),
          ),
        )
      )
      .orderBy(desc(trips.scheduledDate))
      .limit(1);
    return row;
  }

  async getArchivedTrips(): Promise<Trip[]> {
    return db.select().from(trips).where(
      sql`${trips.deletedAt} IS NOT NULL`
    ).orderBy(desc(trips.deletedAt));
  }

  async getArchivedVehicles(): Promise<Vehicle[]> {
    return db.select().from(vehicles).where(
      or(eq(vehicles.active, false), sql`${vehicles.deletedAt} IS NOT NULL`)
    ).orderBy(desc(vehicles.deletedAt));
  }

  async hasActiveTripsForVehicle(vehicleId: number): Promise<boolean> {
    const [row] = await db
      .select({ cnt: count() })
      .from(trips)
      .where(
        and(
          eq(trips.vehicleId, vehicleId),
          or(
            eq(trips.status, "SCHEDULED"),
            eq(trips.status, "ASSIGNED"),
            eq(trips.status, "IN_PROGRESS"),
          ),
        )
      );
    return (row?.cnt ?? 0) > 0;
  }

  async deleteVehicle(id: number): Promise<void> {
    await db.delete(vehicles).where(eq(vehicles.id, id));
  }

  // Archive management methods
  async getArchivedClinics(): Promise<Clinic[]> {
    return db.select().from(clinics).where(
      or(eq(clinics.active, false), sql`${clinics.deletedAt} IS NOT NULL`)
    ).orderBy(desc(clinics.deletedAt));
  }

  async getArchivedDrivers(): Promise<Driver[]> {
    return db.select().from(drivers).where(
      or(eq(drivers.active, false), sql`${drivers.deletedAt} IS NOT NULL`)
    ).orderBy(desc(drivers.deletedAt));
  }

  async getArchivedPatients(): Promise<Patient[]> {
    return db.select().from(patients).where(
      or(eq(patients.active, false), sql`${patients.deletedAt} IS NOT NULL`)
    ).orderBy(desc(patients.deletedAt));
  }

  async getArchivedUsers(): Promise<Omit<User, "password">[]> {
    const rows = await db.select().from(users).where(
      or(eq(users.active, false), sql`${users.deletedAt} IS NOT NULL`)
    ).orderBy(desc(users.deletedAt));
    return rows.map(({ password, ...rest }) => rest) as any;
  }

  // Active trip guard queries
  async hasActiveTripsForClinic(clinicId: number): Promise<boolean> {
    const [row] = await db
      .select({ cnt: count() })
      .from(trips)
      .where(
        and(
          eq(trips.clinicId, clinicId),
          or(
            eq(trips.status, "SCHEDULED"),
            eq(trips.status, "ASSIGNED"),
            eq(trips.status, "IN_PROGRESS"),
          ),
        )
      );
    return (row?.cnt ?? 0) > 0;
  }

  async hasActiveTripsForDriver(driverId: number): Promise<boolean> {
    const [row] = await db
      .select({ cnt: count() })
      .from(trips)
      .where(
        and(
          eq(trips.driverId, driverId),
          or(
            eq(trips.status, "SCHEDULED"),
            eq(trips.status, "ASSIGNED"),
            eq(trips.status, "IN_PROGRESS"),
          ),
        )
      );
    return (row?.cnt ?? 0) > 0;
  }

  async hasActiveTripsForPatient(patientId: number): Promise<boolean> {
    const [row] = await db
      .select({ cnt: count() })
      .from(trips)
      .where(
        and(
          eq(trips.patientId, patientId),
          or(
            eq(trips.status, "SCHEDULED"),
            eq(trips.status, "ASSIGNED"),
            eq(trips.status, "IN_PROGRESS"),
          ),
        )
      );
    return (row?.cnt ?? 0) > 0;
  }

  async getTripSeriesList(cityId?: number): Promise<TripSeries[]> {
    if (cityId) {
      return db.select().from(tripSeries).where(eq(tripSeries.cityId, cityId)).orderBy(desc(tripSeries.createdAt));
    }
    return db.select().from(tripSeries).orderBy(desc(tripSeries.createdAt));
  }

  async getTripSeriesById(id: number): Promise<TripSeries | undefined> {
    const [series] = await db.select().from(tripSeries).where(eq(tripSeries.id, id));
    return series;
  }

  async createTripSeries(data: InsertTripSeries): Promise<TripSeries> {
    const [series] = await db.insert(tripSeries).values(data).returning();
    return series;
  }

  async updateTripSeries(id: number, data: Partial<TripSeries>): Promise<TripSeries | undefined> {
    const { id: _id, ...updateData } = data as any;
    const [series] = await db.update(tripSeries).set(updateData).where(eq(tripSeries.id, id)).returning();
    return series;
  }

  async getTripsBySeriesId(seriesId: number): Promise<Trip[]> {
    return db.select().from(trips).where(eq(trips.tripSeriesId, seriesId)).orderBy(trips.scheduledDate);
  }

  // Permanent delete methods
  async deleteClinic(id: number): Promise<void> {
    await db.delete(clinics).where(eq(clinics.id, id));
  }

  async deleteDriver(id: number): Promise<void> {
    await db.delete(drivers).where(eq(drivers.id, id));
  }

  async deletePatient(id: number): Promise<void> {
    await db.delete(patients).where(eq(patients.id, id));
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(userCityAccess).where(eq(userCityAccess.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }

  async deleteTrip(id: number): Promise<void> {
    await db.delete(tripSmsLog).where(eq(tripSmsLog.tripId, id));
    await db.delete(tripShareTokens).where(eq(tripShareTokens.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
  }

  // Update user method
  async updateUser(id: number, data: Partial<User>): Promise<Omit<User, "password"> | undefined> {
    const { id: _id, password: _pwd, ...updateData } = data as any;
    const [user] = await db.update(users).set(updateData).where(eq(users.id, id)).returning();
    if (!user) return undefined;
    const { password, ...rest } = user;
    return rest as any;
  }

  async getTripEvents(tripId: number): Promise<TripEvent[]> {
    return db.select().from(tripEvents)
      .where(eq(tripEvents.tripId, tripId))
      .orderBy(desc(tripEvents.createdAt));
  }

  async createTripEvent(data: InsertTripEvent): Promise<TripEvent> {
    const [row] = await db.insert(tripEvents).values(data).returning();
    return row;
  }

  async getTripEventsByDateRange(cityId: number, startDate: string, endDate: string): Promise<(TripEvent & { trip: Trip })[]> {
    const rows = await db
      .select({
        event: tripEvents,
        trip: trips,
      })
      .from(tripEvents)
      .innerJoin(trips, eq(tripEvents.tripId, trips.id))
      .where(
        and(
          eq(trips.cityId, cityId),
          sql`${trips.scheduledDate} >= ${startDate}`,
          sql`${trips.scheduledDate} <= ${endDate}`,
          isNull(trips.deletedAt),
        )
      )
      .orderBy(desc(tripEvents.createdAt));
    return rows.map(r => ({ ...r.event, trip: r.trip }));
  }

  async getDriverBonusRule(cityId: number): Promise<DriverBonusRule | undefined> {
    const [row] = await db.select().from(driverBonusRules).where(eq(driverBonusRules.cityId, cityId));
    return row;
  }

  async getAllDriverBonusRules(): Promise<DriverBonusRule[]> {
    return db.select().from(driverBonusRules);
  }

  async upsertDriverBonusRule(data: Partial<DriverBonusRule> & { cityId: number }): Promise<DriverBonusRule> {
    const existing = await this.getDriverBonusRule(data.cityId);
    if (existing) {
      const [row] = await db.update(driverBonusRules)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(driverBonusRules.cityId, data.cityId))
        .returning();
      return row;
    }
    const [row] = await db.insert(driverBonusRules).values(data as any).returning();
    return row;
  }

  async getActiveCities(): Promise<City[]> {
    return db.select().from(cities).where(eq(cities.active, true)).orderBy(cities.name);
  }

  async getTripsForCityAndDate(cityId: number, date: string): Promise<Trip[]> {
    return db.select().from(trips).where(
      and(
        eq(trips.cityId, cityId),
        eq(trips.scheduledDate, date),
        isNull(trips.deletedAt),
      )
    );
  }

  async getTripsForClinicToday(clinicId: number, date: string): Promise<Trip[]> {
    return db.select().from(trips).where(
      and(
        eq(trips.clinicId, clinicId),
        eq(trips.scheduledDate, date),
        isNull(trips.deletedAt),
      )
    );
  }

  async createOpsAlertLog(data: InsertOpsAlertLog): Promise<OpsAlertLog> {
    const [row] = await db.insert(opsAlertLog).values(data).returning();
    return row;
  }

  async getRecentOpsAlerts(cityId: number, date: string, minutesBack: number): Promise<OpsAlertLog[]> {
    const cutoff = new Date(Date.now() - minutesBack * 60 * 1000);
    return db.select().from(opsAlertLog).where(
      and(
        eq(opsAlertLog.cityId, cityId),
        eq(opsAlertLog.date, date),
        sql`${opsAlertLog.sentAt} >= ${cutoff}`,
      )
    ).orderBy(desc(opsAlertLog.sentAt));
  }

  async getOpsAlertsByCityAndDate(cityId: number, date: string): Promise<OpsAlertLog[]> {
    return db.select().from(opsAlertLog).where(
      and(
        eq(opsAlertLog.cityId, cityId),
        eq(opsAlertLog.date, date),
      )
    ).orderBy(desc(opsAlertLog.sentAt));
  }

  async createClinicAlertLog(data: InsertClinicAlertLog): Promise<ClinicAlertLog> {
    const [row] = await db.insert(clinicAlertLog).values(data).returning();
    return row;
  }

  async getRecentClinicAlerts(clinicId: number, minutesBack: number): Promise<ClinicAlertLog[]> {
    const cutoff = new Date(Date.now() - minutesBack * 60 * 1000);
    return db.select().from(clinicAlertLog).where(
      and(
        eq(clinicAlertLog.clinicId, clinicId),
        sql`${clinicAlertLog.sentAt} >= ${cutoff}`,
      )
    ).orderBy(desc(clinicAlertLog.sentAt));
  }

  async getClinicAlertsByClinicId(clinicId: number, limit?: number): Promise<ClinicAlertLog[]> {
    const q = db.select().from(clinicAlertLog)
      .where(eq(clinicAlertLog.clinicId, clinicId))
      .orderBy(desc(clinicAlertLog.sentAt));
    if (limit) return q.limit(limit);
    return q;
  }

  async createClinicHelpRequest(data: InsertClinicHelpRequest): Promise<ClinicHelpRequest> {
    const [row] = await db.insert(clinicHelpRequests).values(data).returning();
    return row;
  }

  async getClinicHelpRequests(clinicId?: number): Promise<ClinicHelpRequest[]> {
    if (clinicId) {
      return db.select().from(clinicHelpRequests)
        .where(eq(clinicHelpRequests.clinicId, clinicId))
        .orderBy(desc(clinicHelpRequests.createdAt));
    }
    return db.select().from(clinicHelpRequests).orderBy(desc(clinicHelpRequests.createdAt));
  }

  async resolveClinicHelpRequest(id: number, userId: number): Promise<ClinicHelpRequest | undefined> {
    const [row] = await db.update(clinicHelpRequests)
      .set({ resolved: true, resolvedBy: userId, resolvedAt: new Date() })
      .where(eq(clinicHelpRequests.id, id))
      .returning();
    return row;
  }

  async createRouteBatch(data: InsertRouteBatch): Promise<RouteBatch> {
    const [row] = await db.insert(routeBatches).values(data).returning();
    return row;
  }

  async getRouteBatchesByDate(cityId: number, date: string): Promise<RouteBatch[]> {
    return db.select().from(routeBatches).where(
      and(eq(routeBatches.cityId, cityId), eq(routeBatches.date, date))
    ).orderBy(routeBatches.id);
  }

  async updateRouteBatch(id: number, data: Partial<RouteBatch>): Promise<RouteBatch | undefined> {
    const [row] = await db.update(routeBatches).set(data).where(eq(routeBatches.id, id)).returning();
    return row;
  }

  async deleteRouteBatchesByDate(cityId: number, date: string): Promise<void> {
    await db.delete(routeBatches).where(
      and(eq(routeBatches.cityId, cityId), eq(routeBatches.date, date))
    );
  }

  async createDriverScore(data: InsertDriverScore): Promise<DriverScore> {
    const [row] = await db.insert(driverScores).values(data).returning();
    return row;
  }

  async getDriverScores(cityId: number, weekStart?: string): Promise<DriverScore[]> {
    const conditions = [eq(driverScores.cityId, cityId)];
    if (weekStart) conditions.push(eq(driverScores.weekStart, weekStart));
    return db.select().from(driverScores).where(and(...conditions)).orderBy(desc(driverScores.score));
  }

  async getDriverScoreHistory(driverId: number, limit = 12): Promise<DriverScore[]> {
    return db.select().from(driverScores)
      .where(eq(driverScores.driverId, driverId))
      .orderBy(desc(driverScores.weekStart))
      .limit(limit);
  }

  async deleteDriverScoresByWeek(cityId: number, weekStart: string): Promise<void> {
    await db.delete(driverScores).where(
      and(eq(driverScores.cityId, cityId), eq(driverScores.weekStart, weekStart))
    );
  }

  async updateTripConfirmation(tripId: number, status: string, time?: Date): Promise<Trip | undefined> {
    const updates: any = { confirmationStatus: status };
    if (time) updates.confirmationTime = time;
    if (status !== "confirmed") updates.noShowRisk = true;
    else updates.noShowRisk = false;
    const [row] = await db.update(trips).set(updates).where(eq(trips.id, tripId)).returning();
    return row;
  }

  async getUnconfirmedTripsForDate(cityId: number, date: string): Promise<Trip[]> {
    return db.select().from(trips).where(
      and(
        eq(trips.cityId, cityId),
        eq(trips.scheduledDate, date),
        sql`${trips.confirmationStatus} != 'confirmed'`,
        isNull(trips.deletedAt),
        sql`${trips.status} NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')`,
      )
    );
  }

  async getTripsNeedingConfirmation(cityId: number, date: string, hoursAhead: number): Promise<Trip[]> {
    return db.select().from(trips).where(
      and(
        eq(trips.cityId, cityId),
        eq(trips.scheduledDate, date),
        sql`${trips.confirmationStatus} = 'unconfirmed'`,
        isNull(trips.deletedAt),
        sql`${trips.status} NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')`,
      )
    );
  }

  async getPatientNoShowCount(patientId: number): Promise<number> {
    const result = await db.select({ cnt: count() }).from(tripEvents).where(
      and(
        eq(tripEvents.eventType, "no_show_patient"),
        sql`${tripEvents.tripId} IN (SELECT id FROM trips WHERE patient_id = ${patientId})`,
      )
    );
    return result[0]?.cnt || 0;
  }

  async getDailyFinancialStats(cityId: number, date: string): Promise<any> {
    const dayTrips = await db.select().from(trips).where(
      and(
        eq(trips.cityId, cityId),
        eq(trips.scheduledDate, date),
        isNull(trips.deletedAt),
      )
    );

    const total = dayTrips.length;
    const completed = dayTrips.filter(t => t.status === "COMPLETED").length;
    const cancelled = dayTrips.filter(t => t.status === "CANCELLED").length;
    const noShow = dayTrips.filter(t => t.status === "NO_SHOW").length;
    const totalMiles = dayTrips.reduce((s, t) => s + (t.distanceMiles ? parseFloat(t.distanceMiles) : 0), 0);

    const dayInvoices = await db.select().from(invoices).where(
      and(
        eq(invoices.serviceDate, date),
        sql`${invoices.clinicId} IN (SELECT id FROM clinics WHERE city_id = ${cityId})`,
      )
    );
    const estimatedRevenue = dayInvoices.reduce((s, inv) => s + parseFloat(inv.amount), 0);

    const driversWithTrips = new Set(dayTrips.filter(t => t.driverId).map(t => t.driverId));
    const milesPerDriver = driversWithTrips.size > 0 ? Math.round(totalMiles / driversWithTrips.size * 10) / 10 : 0;

    return {
      date,
      cityId,
      totalTrips: total,
      completed,
      cancelled,
      noShow,
      noShowLoss: noShow,
      estimatedRevenue: Math.round(estimatedRevenue * 100) / 100,
      totalMiles: Math.round(totalMiles * 10) / 10,
      milesPerDriver,
      activeDrivers: driversWithTrips.size,
    };
  }

  async getRecurringSchedulesByPatient(patientId: number): Promise<RecurringSchedule[]> {
    return db.select().from(recurringSchedules).where(eq(recurringSchedules.patientId, patientId)).orderBy(desc(recurringSchedules.createdAt));
  }

  async getRecurringSchedulesByCity(cityId: number): Promise<RecurringSchedule[]> {
    return db.select().from(recurringSchedules).where(and(eq(recurringSchedules.cityId, cityId), eq(recurringSchedules.active, true))).orderBy(desc(recurringSchedules.createdAt));
  }

  async getActiveRecurringSchedules(): Promise<RecurringSchedule[]> {
    return db.select().from(recurringSchedules).where(eq(recurringSchedules.active, true));
  }

  async createRecurringSchedule(data: InsertRecurringSchedule): Promise<RecurringSchedule> {
    const [schedule] = await db.insert(recurringSchedules).values(data).returning();
    return schedule;
  }

  async updateRecurringSchedule(id: number, data: Partial<RecurringSchedule>): Promise<RecurringSchedule | undefined> {
    const [schedule] = await db.update(recurringSchedules).set(data).where(eq(recurringSchedules.id, id)).returning();
    return schedule;
  }

  async deleteRecurringSchedule(id: number): Promise<void> {
    await db.update(recurringSchedules).set({ active: false }).where(eq(recurringSchedules.id, id));
  }

  async getClinicTariffs(clinicId: number): Promise<ClinicTariff[]> {
    return db.select().from(clinicTariffs).where(eq(clinicTariffs.clinicId, clinicId)).orderBy(desc(clinicTariffs.effectiveFrom));
  }

  async getClinicTariff(id: number): Promise<ClinicTariff | undefined> {
    const [row] = await db.select().from(clinicTariffs).where(eq(clinicTariffs.id, id));
    return row;
  }

  async getActiveTariff(clinicId: number, cityId?: number | null): Promise<ClinicTariff | undefined> {
    const conditions = [eq(clinicTariffs.clinicId, clinicId), eq(clinicTariffs.active, true)];
    if (cityId) conditions.push(eq(clinicTariffs.cityId, cityId));
    const [row] = await db.select().from(clinicTariffs).where(and(...conditions)).orderBy(desc(clinicTariffs.effectiveFrom)).limit(1);
    return row;
  }

  async createClinicTariff(data: InsertClinicTariff): Promise<ClinicTariff> {
    const [row] = await db.insert(clinicTariffs).values(data).returning();
    return row;
  }

  async updateClinicTariff(id: number, data: Partial<ClinicTariff>): Promise<ClinicTariff | undefined> {
    const { id: _id, ...updateData } = data as any;
    const [row] = await db.update(clinicTariffs).set(updateData).where(eq(clinicTariffs.id, id)).returning();
    return row;
  }

  async getTripBilling(tripId: number): Promise<TripBilling | undefined> {
    const [row] = await db.select().from(tripBilling).where(eq(tripBilling.tripId, tripId));
    return row;
  }

  async createTripBilling(data: InsertTripBilling): Promise<TripBilling> {
    const [row] = await db.insert(tripBilling).values(data).returning();
    return row;
  }

  async getTripBillingsByClinic(clinicId: number, month?: string): Promise<TripBilling[]> {
    const conditions = [eq(tripBilling.clinicId, clinicId)];
    if (month) {
      conditions.push(sql`to_char(${tripBilling.createdAt}, 'YYYY-MM') = ${month}`);
    }
    return db.select().from(tripBilling).where(and(...conditions)).orderBy(desc(tripBilling.createdAt));
  }

  async getClinicInvoicesMonthly(clinicId?: number): Promise<ClinicInvoiceMonthly[]> {
    if (clinicId) {
      return db.select().from(clinicInvoicesMonthly).where(eq(clinicInvoicesMonthly.clinicId, clinicId)).orderBy(desc(clinicInvoicesMonthly.generatedAt));
    }
    return db.select().from(clinicInvoicesMonthly).orderBy(desc(clinicInvoicesMonthly.generatedAt));
  }

  async getClinicInvoiceMonthly(id: number): Promise<ClinicInvoiceMonthly | undefined> {
    const [row] = await db.select().from(clinicInvoicesMonthly).where(eq(clinicInvoicesMonthly.id, id));
    return row;
  }

  async createClinicInvoiceMonthly(data: InsertClinicInvoiceMonthly): Promise<ClinicInvoiceMonthly> {
    const [row] = await db.insert(clinicInvoicesMonthly).values(data).returning();
    return row;
  }

  async updateClinicInvoiceMonthly(id: number, data: Partial<ClinicInvoiceMonthly>): Promise<ClinicInvoiceMonthly | undefined> {
    const { id: _id, ...updateData } = data as any;
    const [row] = await db.update(clinicInvoicesMonthly).set(updateData).where(eq(clinicInvoicesMonthly.id, id)).returning();
    return row;
  }

  async createClinicInvoiceItem(data: InsertClinicInvoiceItem): Promise<ClinicInvoiceItem> {
    const [row] = await db.insert(clinicInvoiceItems).values(data).returning();
    return row;
  }

  async getClinicInvoiceItems(invoiceId: number): Promise<ClinicInvoiceItem[]> {
    return db.select().from(clinicInvoiceItems).where(eq(clinicInvoiceItems.invoiceId, invoiceId));
  }

  async getTripSignature(tripId: number): Promise<TripSignature | undefined> {
    const [row] = await db.select().from(tripSignatures).where(eq(tripSignatures.tripId, tripId));
    return row;
  }

  async upsertTripSignature(tripId: number, data: Partial<InsertTripSignature>): Promise<TripSignature> {
    const existing = await this.getTripSignature(tripId);
    if (existing) {
      const [row] = await db.update(tripSignatures).set(data).where(eq(tripSignatures.tripId, tripId)).returning();
      return row;
    }
    const [row] = await db.insert(tripSignatures).values({ tripId, ...data }).returning();
    return row;
  }

  async getClinicBillingSettings(clinicId: number): Promise<ClinicBillingSettingsType | undefined> {
    const [row] = await db.select().from(clinicBillingSettings).where(eq(clinicBillingSettings.clinicId, clinicId));
    return row;
  }

  async upsertClinicBillingSettings(data: InsertClinicBillingSettings): Promise<ClinicBillingSettingsType> {
    const existing = await this.getClinicBillingSettings(data.clinicId);
    if (existing) {
      const { clinicId, createdAt, ...updateData } = data as any;
      const [row] = await db.update(clinicBillingSettings)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(clinicBillingSettings.clinicId, data.clinicId))
        .returning();
      return row;
    }
    const [row] = await db.insert(clinicBillingSettings).values(data).returning();
    return row;
  }

  async getBillingCycleInvoice(id: number): Promise<BillingCycleInvoice | undefined> {
    const [row] = await db.select().from(billingCycleInvoices).where(eq(billingCycleInvoices.id, id));
    return row;
  }

  async getBillingCycleInvoices(clinicId: number, status?: string, from?: string, to?: string): Promise<BillingCycleInvoice[]> {
    const conditions: any[] = [eq(billingCycleInvoices.clinicId, clinicId)];
    if (status) conditions.push(eq(billingCycleInvoices.status, status as any));
    if (from) conditions.push(sql`${billingCycleInvoices.periodStart} >= ${from}`);
    if (to) conditions.push(sql`${billingCycleInvoices.periodEnd} <= ${to}`);
    return db.select().from(billingCycleInvoices)
      .where(and(...conditions))
      .orderBy(desc(billingCycleInvoices.createdAt));
  }

  async findBillingCycleInvoice(clinicId: number, periodStart: string, periodEnd: string): Promise<BillingCycleInvoice | undefined> {
    const [row] = await db.select().from(billingCycleInvoices)
      .where(and(
        eq(billingCycleInvoices.clinicId, clinicId),
        eq(billingCycleInvoices.periodStart, periodStart),
        eq(billingCycleInvoices.periodEnd, periodEnd),
        ne(billingCycleInvoices.status, "void"),
      ));
    return row;
  }

  async createBillingCycleInvoice(data: InsertBillingCycleInvoice): Promise<BillingCycleInvoice> {
    const [row] = await db.insert(billingCycleInvoices).values(data).returning();
    return row;
  }

  async updateBillingCycleInvoice(id: number, data: Partial<BillingCycleInvoice>): Promise<BillingCycleInvoice | undefined> {
    const { id: _id, ...updateData } = data as any;
    const [row] = await db.update(billingCycleInvoices)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(billingCycleInvoices.id, id))
      .returning();
    return row;
  }

  async getBillingCycleInvoiceItems(invoiceId: number): Promise<BillingCycleInvoiceItem[]> {
    return db.select().from(billingCycleInvoiceItems)
      .where(eq(billingCycleInvoiceItems.invoiceId, invoiceId));
  }

  async createBillingCycleInvoiceItem(data: InsertBillingCycleInvoiceItem): Promise<BillingCycleInvoiceItem> {
    const [row] = await db.insert(billingCycleInvoiceItems).values(data).returning();
    return row;
  }

  async getEligibleTripsForBilling(clinicId: number, periodStart: string, periodEnd: string): Promise<Trip[]> {
    const alreadyBilledIds = await this.getTripIdsAlreadyBilled(clinicId);
    const conditions: any[] = [
      eq(trips.clinicId, clinicId),
      eq(trips.status, "COMPLETED"),
      sql`${trips.completedAt} >= ${periodStart}::timestamptz`,
      sql`${trips.completedAt} < ${periodEnd}::timestamptz`,
    ];
    if (alreadyBilledIds.length > 0) {
      conditions.push(sql`${trips.id} NOT IN (${sql.join(alreadyBilledIds.map(id => sql`${id}`), sql`, `)})`);
    }
    return db.select().from(trips).where(and(...conditions));
  }

  async getTripIdsAlreadyBilled(clinicId: number): Promise<number[]> {
    const rows = await db
      .select({ tripId: billingCycleInvoiceItems.tripId })
      .from(billingCycleInvoiceItems)
      .innerJoin(billingCycleInvoices, eq(billingCycleInvoiceItems.invoiceId, billingCycleInvoices.id))
      .where(and(
        eq(billingCycleInvoices.clinicId, clinicId),
        ne(billingCycleInvoices.status, "void"),
        sql`${billingCycleInvoiceItems.tripId} IS NOT NULL`,
      ));
    return rows.map(r => r.tripId!).filter(Boolean);
  }

  async createInvoicePayment(data: InsertInvoicePayment): Promise<InvoicePayment> {
    const [row] = await db.insert(invoicePayments).values(data).returning();
    return row;
  }

  async getInvoicePayments(invoiceId: number): Promise<InvoicePayment[]> {
    return db.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoiceId))
      .orderBy(desc(invoicePayments.paidAt));
  }

  async findPaymentByReference(reference: string): Promise<InvoicePayment | undefined> {
    const [row] = await db.select().from(invoicePayments)
      .where(eq(invoicePayments.reference, reference));
    return row;
  }

  async findPaymentByStripePI(stripePaymentIntentId: string): Promise<InvoicePayment | undefined> {
    const [row] = await db.select().from(invoicePayments)
      .where(eq(invoicePayments.stripePaymentIntentId, stripePaymentIntentId));
    return row;
  }

  async nextInvoiceNumber(): Promise<string> {
    const result = await db.execute(sql`
      UPDATE invoice_sequences 
      SET last_number = last_number + 1, updated_at = now()
      WHERE id = 1
      RETURNING last_number, prefix
    `);
    const row = (result as any).rows?.[0] || (result as any)[0];
    const num = row.last_number;
    const prefix = row.prefix || "INV";
    return `${prefix}-${String(num).padStart(6, "0")}`;
  }

  async getBillingCycleInvoicesByPaymentStatus(statuses: string[], clinicId?: number): Promise<BillingCycleInvoice[]> {
    const conditions: any[] = [
      eq(billingCycleInvoices.status, "finalized"),
    ];
    if (statuses.length > 0) {
      conditions.push(sql`${billingCycleInvoices.paymentStatus} IN (${sql.join(statuses.map(s => sql`${s}`), sql`, `)})`);
    }
    if (clinicId) {
      conditions.push(eq(billingCycleInvoices.clinicId, clinicId));
    }
    return db.select().from(billingCycleInvoices)
      .where(and(...conditions))
      .orderBy(desc(billingCycleInvoices.dueDate));
  }

  async createAiEngineSnapshot(data: InsertAiEngineSnapshot): Promise<AiEngineSnapshot> {
    const [row] = await db.insert(aiEngineSnapshots).values(data).returning();
    return row;
  }

  async getLatestAiEngineSnapshot(): Promise<AiEngineSnapshot | undefined> {
    const [row] = await db.select().from(aiEngineSnapshots).orderBy(desc(aiEngineSnapshots.computedAt)).limit(1);
    return row;
  }

  async getRecentTripsUpdatedSince(since: Date): Promise<Trip[]> {
    return db.select().from(trips).where(
      and(
        gte(trips.updatedAt, since),
        isNull(trips.deletedAt),
      )
    );
  }

  async getRecentDriversUpdatedSince(since: Date): Promise<Driver[]> {
    return db.select().from(drivers).where(
      or(
        gte(drivers.updatedAt, since),
        gte(drivers.lastSeenAt, since),
        gte(drivers.lastActiveAt, since),
      )
    );
  }

  async getCompanyStripeAccount(companyId: number): Promise<CompanyStripeAccount | undefined> {
    const [row] = await db.select().from(companyStripeAccounts).where(eq(companyStripeAccounts.companyId, companyId));
    return row;
  }

  async upsertCompanyStripeAccount(data: InsertCompanyStripeAccount): Promise<CompanyStripeAccount> {
    const existing = await this.getCompanyStripeAccount(data.companyId);
    if (existing) {
      const [updated] = await db.update(companyStripeAccounts)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(companyStripeAccounts.companyId, data.companyId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(companyStripeAccounts).values(data).returning();
    return created;
  }

  async updateCompanyStripeAccount(companyId: number, data: Partial<CompanyStripeAccount>): Promise<CompanyStripeAccount> {
    const [updated] = await db.update(companyStripeAccounts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(companyStripeAccounts.companyId, companyId))
      .returning();
    return updated;
  }

  async insertStripeWebhookEvent(stripeEventId: string, type: string): Promise<{ inserted: boolean }> {
    try {
      await db.insert(stripeWebhookEvents).values({ stripeEventId, type });
      return { inserted: true };
    } catch (err: any) {
      if (err.code === "23505") return { inserted: false };
      throw err;
    }
  }

  async updateStripeWebhookEvent(stripeEventId: string, status: string, error?: string | null): Promise<void> {
    await db.update(stripeWebhookEvents)
      .set({ status, error: error || null, processedAt: status === "PROCESSED" ? new Date() : undefined })
      .where(eq(stripeWebhookEvents.stripeEventId, stripeEventId));
  }

  async getCompanyCities(companyId: number): Promise<number[]> {
    const rows = await db.select({ cityId: companyCities.cityId })
      .from(companyCities)
      .where(and(eq(companyCities.companyId, companyId), eq(companyCities.isActive, true)));
    return rows.map(r => r.cityId);
  }

  async setCompanyCities(companyId: number, cityIds: number[]): Promise<void> {
    await db.delete(companyCities).where(eq(companyCities.companyId, companyId));
    if (cityIds.length > 0) {
      await db.insert(companyCities)
        .values(cityIds.map(cityId => ({ companyId, cityId })))
        .onConflictDoNothing();
    }
  }

  async getCitiesForCompany(companyId: number): Promise<City[]> {
    const rows = await db.select({ city: cities })
      .from(companyCities)
      .innerJoin(cities, eq(companyCities.cityId, cities.id))
      .where(and(eq(companyCities.companyId, companyId), eq(companyCities.isActive, true)));
    return rows.map(r => r.city);
  }

  async getClinicCompanies(clinicId: number): Promise<number[]> {
    const rows = await db.select({ companyId: clinicCompanies.companyId })
      .from(clinicCompanies)
      .where(and(eq(clinicCompanies.clinicId, clinicId), eq(clinicCompanies.isActive, true)));
    return rows.map(r => r.companyId);
  }

  async setClinicCompanies(clinicId: number, companyIds: number[]): Promise<void> {
    await db.delete(clinicCompanies).where(eq(clinicCompanies.clinicId, clinicId));
    if (companyIds.length > 0) {
      await db.insert(clinicCompanies)
        .values(companyIds.map(companyId => ({ clinicId, companyId })))
        .onConflictDoNothing();
    }
  }

  async getCompaniesForClinic(clinicId: number): Promise<Company[]> {
    const rows = await db.select({ company: companies })
      .from(clinicCompanies)
      .innerJoin(companies, eq(clinicCompanies.companyId, companies.id))
      .where(and(eq(clinicCompanies.clinicId, clinicId), eq(clinicCompanies.isActive, true)));
    return rows.map(r => r.company);
  }

  async setUserWorkingCity(userId: number, cityId: number | null, scope?: string): Promise<void> {
    await db.update(users)
      .set({
        workingCityId: cityId,
        workingCityScope: scope || (cityId === null ? "ALL" : "CITY"),
      })
      .where(eq(users.id, userId));
  }
}

export const storage = new DatabaseStorage();
