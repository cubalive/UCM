import { db } from "./db";
import { eq, and, desc, sql, inArray, count } from "drizzle-orm";
import {
  cities, users, userCityAccess, vehicles, drivers, clinics, patients, trips, auditLog,
  type InsertCity, type InsertUser, type InsertVehicle, type InsertDriver,
  type InsertClinic, type InsertPatient, type InsertTrip, type InsertAuditLog,
  type City, type User, type Vehicle, type Driver, type Clinic, type Patient, type Trip, type AuditLog,
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
  createVehicle(data: InsertVehicle): Promise<Vehicle>;

  getDrivers(cityId?: number): Promise<Driver[]>;
  createDriver(data: InsertDriver): Promise<Driver>;

  getClinics(cityId?: number): Promise<Clinic[]>;
  createClinic(data: InsertClinic): Promise<Clinic>;

  getPatients(cityId?: number): Promise<Patient[]>;
  createPatient(data: InsertPatient): Promise<Patient>;

  getTrips(cityId?: number, limit?: number): Promise<Trip[]>;
  createTrip(data: InsertTrip): Promise<Trip>;
  updateTripStatus(id: number, status: string): Promise<Trip | undefined>;

  getAuditLogs(cityId?: number): Promise<AuditLog[]>;
  createAuditLog(data: InsertAuditLog): Promise<AuditLog>;

  getStats(cityId?: number): Promise<Record<string, number>>;
  getTripStatusSummary(cityId?: number): Promise<Record<string, number>>;
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

  async createDriver(data: InsertDriver): Promise<Driver> {
    const [driver] = await db.insert(drivers).values(data).returning();
    return driver;
  }

  async getClinics(cityId?: number): Promise<Clinic[]> {
    if (cityId) {
      return db.select().from(clinics).where(eq(clinics.cityId, cityId)).orderBy(clinics.name);
    }
    return db.select().from(clinics).orderBy(clinics.name);
  }

  async createClinic(data: InsertClinic): Promise<Clinic> {
    const [clinic] = await db.insert(clinics).values(data).returning();
    return clinic;
  }

  async getPatients(cityId?: number): Promise<Patient[]> {
    if (cityId) {
      return db.select().from(patients).where(eq(patients.cityId, cityId)).orderBy(patients.firstName);
    }
    return db.select().from(patients).orderBy(patients.firstName);
  }

  async createPatient(data: InsertPatient): Promise<Patient> {
    const [patient] = await db.insert(patients).values(data).returning();
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

  async createTrip(data: InsertTrip): Promise<Trip> {
    const [trip] = await db.insert(trips).values(data).returning();
    return trip;
  }

  async updateTripStatus(id: number, status: string): Promise<Trip | undefined> {
    const [trip] = await db.update(trips).set({ status: status as any }).where(eq(trips.id, id)).returning();
    return trip;
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
}

export const storage = new DatabaseStorage();
