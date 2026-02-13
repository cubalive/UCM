import { db } from "./db";
import { eq, and, desc, sql, inArray, count, ne, isNull } from "drizzle-orm";
import {
  cities, users, userCityAccess, vehicles, drivers, clinics, patients, trips, auditLog, smsOptOut,
  type InsertCity, type InsertUser, type InsertVehicle, type InsertDriver,
  type InsertClinic, type InsertPatient, type InsertTrip, type InsertAuditLog,
  type City, type User, type Vehicle, type Driver, type Clinic, type Patient, type Trip, type AuditLog, type SmsOptOut,
} from "@shared/schema";

export interface IStorage {
  getCities(): Promise<City[]>;
  getCity(id: number): Promise<City | undefined>;
  createCity(data: InsertCity): Promise<City>;

  getUsers(): Promise<Omit<User, "password">[]>;
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(data: InsertUser): Promise<Omit<User, "password">>;
  getUserCityAccess(userId: number): Promise<number[]>;
  setUserCityAccess(userId: number, cityIds: number[]): Promise<void>;

  getVehicles(cityId?: number): Promise<Vehicle[]>;
  getVehicle(id: number): Promise<Vehicle | undefined>;
  createVehicle(data: InsertVehicle): Promise<Vehicle>;

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

  getAuditLogs(cityId?: number): Promise<AuditLog[]>;
  createAuditLog(data: InsertAuditLog): Promise<AuditLog>;

  getStats(cityId?: number): Promise<Record<string, number>>;
  getTripStatusSummary(cityId?: number): Promise<Record<string, number>>;

  isPhoneOptedOut(phone: string): Promise<boolean>;
  setPhoneOptOut(phone: string, optedOut: boolean): Promise<void>;
}

export class DatabaseStorage implements IStorage {
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

  async getUsers(): Promise<Omit<User, "password">[]> {
    const rows = await db.select().from(users).orderBy(users.firstName);
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
      return db.select().from(vehicles).where(eq(vehicles.cityId, cityId)).orderBy(vehicles.name);
    }
    return db.select().from(vehicles).orderBy(vehicles.name);
  }

  async getVehicle(id: number): Promise<Vehicle | undefined> {
    const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    return vehicle;
  }

  async createVehicle(data: InsertVehicle): Promise<Vehicle> {
    const [vehicle] = await db.insert(vehicles).values(data).returning();
    return vehicle;
  }

  async getDrivers(cityId?: number): Promise<Driver[]> {
    if (cityId) {
      return db.select().from(drivers).where(eq(drivers.cityId, cityId)).orderBy(drivers.firstName);
    }
    return db.select().from(drivers).orderBy(drivers.firstName);
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
      return db.select().from(clinics).where(eq(clinics.cityId, cityId)).orderBy(clinics.name);
    }
    return db.select().from(clinics).orderBy(clinics.name);
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
      return db.select().from(patients).where(eq(patients.cityId, cityId)).orderBy(patients.firstName);
    }
    return db.select().from(patients).orderBy(patients.firstName);
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
      query = query.where(eq(trips.cityId, cityId)) as any;
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
        inArray(trips.status, ["ASSIGNED", "IN_PROGRESS"]),
        sql`${trips.driverId} IS NOT NULL`
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
}

export const storage = new DatabaseStorage();
