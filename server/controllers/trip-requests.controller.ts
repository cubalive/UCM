import type { Response } from "express";
import { type AuthRequest } from "../auth";
import { db } from "../db";
import { tripRequests, chatThreads, chatMessages, trips } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { generatePublicId } from "../public-id";
import { storage } from "../storage";
import { getClinicScopeId } from "../middleware/requireClinicScope";

function getCompanyScope(req: AuthRequest): number | null {
  if (req.user?.role === "SUPER_ADMIN") return null;
  return req.user?.companyId ?? null;
}

export async function clinicCreateTripRequest(req: AuthRequest, res: Response) {
  try {
    const clinicId = getClinicScopeId(req);
    if (!clinicId) return res.status(403).json({ message: "Clinic scope required" });

    const clinic = await storage.getClinic(clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const { patientId, pickupAddress, dropoffAddress, scheduledDate, scheduledTime,
      serviceLevel, isRoundTrip, recurrenceRule, passengerCount, notes,
      pickupLat, pickupLng, dropoffLat, dropoffLng, companyId, cityId } = req.body;

    const resolvedCompanyId = clinic.companyId || companyId;
    const resolvedCityId = clinic.cityId || cityId;

    if (!resolvedCompanyId) {
      return res.status(400).json({ message: "Company ID required" });
    }

    if (patientId) {
      const patient = await storage.getPatient(patientId);
      if (!patient || patient.clinicId !== clinicId) {
        return res.status(400).json({ message: "Patient not found or not associated with this clinic" });
      }
      if (resolvedCompanyId && patient.companyId && patient.companyId !== resolvedCompanyId) {
        return res.status(400).json({ message: "Patient does not belong to this company" });
      }
    }

    const publicId = await generatePublicId();

    const [request] = await db.insert(tripRequests).values({
      publicId,
      companyId: resolvedCompanyId,
      clinicId,
      cityId: resolvedCityId,
      patientId: patientId || null,
      requestedByUserId: req.user!.userId,
      status: "PENDING",
      pickupAddress,
      pickupLat: pickupLat || null,
      pickupLng: pickupLng || null,
      dropoffAddress,
      dropoffLat: dropoffLat || null,
      dropoffLng: dropoffLng || null,
      scheduledDate,
      scheduledTime,
      serviceLevel: serviceLevel || "ambulatory",
      isRoundTrip: isRoundTrip || false,
      recurrenceRule: recurrenceRule || null,
      passengerCount: passengerCount || 1,
      notes: notes || null,
    } as any).returning();

    await db.insert(chatThreads).values({
      scopeType: "TRIP_REQUEST",
      scopeId: request.id,
      companyId: resolvedCompanyId,
      clinicId,
    } as any).onConflictDoNothing();

    return res.status(201).json(request);
  } catch (err: any) {
    console.error("Error creating trip request:", err);
    return res.status(500).json({ message: "Failed to create trip request" });
  }
}

export async function clinicListTripRequests(req: AuthRequest, res: Response) {
  try {
    let clinicId = getClinicScopeId(req);
    if (!clinicId && req.query.clinicId) {
      const qClinicId = parseInt(req.query.clinicId as string);
      if (!isNaN(qClinicId)) {
        const clinic = await storage.getClinic(qClinicId);
        if (!clinic) return res.status(404).json({ message: "Clinic not found" });
        const user = await storage.getUser(req.user!.userId);
        if (user?.companyId && clinic.companyId !== user.companyId && req.user!.role !== "SUPER_ADMIN") {
          return res.status(403).json({ message: "Access denied" });
        }
        clinicId = qClinicId;
      }
    }

    if (!clinicId && ["COMPANY_ADMIN", "ADMIN"].includes(req.user!.role)) {
      const companyId = req.user!.companyId;
      if (companyId) {
        const status = req.query.status as string | undefined;
        const conditions = [eq(tripRequests.companyId, companyId)];
        if (status) {
          conditions.push(eq(tripRequests.status, status as any));
        }
        const requests = await db.select().from(tripRequests)
          .where(and(...conditions))
          .orderBy(desc(tripRequests.createdAt))
          .limit(200);
        const enriched = await enrichTripRequests(requests);
        return res.json(enriched);
      }
    }

    if (!clinicId) return res.status(403).json({ message: "Clinic scope required" });

    const status = req.query.status as string | undefined;
    const conditions = [eq(tripRequests.clinicId, clinicId)];
    if (status) {
      conditions.push(eq(tripRequests.status, status as any));
    }

    const requests = await db.select().from(tripRequests)
      .where(and(...conditions))
      .orderBy(desc(tripRequests.createdAt))
      .limit(200);

    const enriched = await enrichTripRequests(requests);
    return res.json(enriched);
  } catch (err: any) {
    console.error("Error listing trip requests:", err);
    return res.status(500).json({ message: "Failed to list trip requests" });
  }
}

export async function clinicGetTripRequest(req: AuthRequest, res: Response) {
  try {
    let clinicId = getClinicScopeId(req);
    if (!clinicId && req.query.clinicId) {
      const qClinicId = parseInt(req.query.clinicId as string);
      if (!isNaN(qClinicId)) {
        const clinic = await storage.getClinic(qClinicId);
        if (!clinic) return res.status(404).json({ message: "Clinic not found" });
        const user = await storage.getUser(req.user!.userId);
        if (user?.companyId && clinic.companyId !== user.companyId && req.user!.role !== "SUPER_ADMIN") {
          return res.status(403).json({ message: "Access denied" });
        }
        clinicId = qClinicId;
      }
    }

    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    if (!clinicId && ["COMPANY_ADMIN", "ADMIN"].includes(req.user!.role)) {
      const companyId = req.user!.companyId;
      if (companyId) {
        const [request] = await db.select().from(tripRequests)
          .where(and(eq(tripRequests.id, id), eq(tripRequests.companyId, companyId)));
        if (!request) return res.status(404).json({ message: "Trip request not found" });
        const [enriched] = await enrichTripRequests([request]);
        return res.json(enriched);
      }
    }

    if (!clinicId) return res.status(403).json({ message: "Clinic scope required" });

    const [request] = await db.select().from(tripRequests)
      .where(and(eq(tripRequests.id, id), eq(tripRequests.clinicId, clinicId)));

    if (!request) return res.status(404).json({ message: "Trip request not found" });

    const [enriched] = await enrichTripRequests([request]);
    return res.json(enriched);
  } catch (err: any) {
    console.error("Error getting trip request:", err);
    return res.status(500).json({ message: "Failed to get trip request" });
  }
}

export async function clinicCancelTripRequest(req: AuthRequest, res: Response) {
  try {
    let clinicId = getClinicScopeId(req);

    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    let scopeConditions;
    if (!clinicId && ["COMPANY_ADMIN", "ADMIN"].includes(req.user!.role) && req.user!.companyId) {
      scopeConditions = and(eq(tripRequests.id, id), eq(tripRequests.companyId, req.user!.companyId));
    } else if (clinicId) {
      scopeConditions = and(eq(tripRequests.id, id), eq(tripRequests.clinicId, clinicId));
    } else {
      return res.status(403).json({ message: "Clinic scope required" });
    }

    const [request] = await db.select().from(tripRequests)
      .where(scopeConditions);

    if (!request) return res.status(404).json({ message: "Trip request not found" });
    if (request.status === "APPROVED" || request.status === "CANCELLED") {
      return res.status(400).json({ message: `Cannot cancel request with status ${request.status}` });
    }

    const [updated] = await db.update(tripRequests)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(eq(tripRequests.id, id))
      .returning();

    return res.json(updated);
  } catch (err: any) {
    console.error("Error cancelling trip request:", err);
    return res.status(500).json({ message: "Failed to cancel trip request" });
  }
}

export async function dispatchListTripRequests(req: AuthRequest, res: Response) {
  try {
    const companyId = getCompanyScope(req);
    const statusFilter = req.query.status as string | undefined;
    const cityFilter = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;

    const conditions: any[] = [];
    if (companyId) conditions.push(eq(tripRequests.companyId, companyId));
    if (statusFilter) conditions.push(eq(tripRequests.status, statusFilter as any));
    if (cityFilter) conditions.push(eq(tripRequests.cityId, cityFilter));

    const requests = await db.select().from(tripRequests)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(tripRequests.createdAt))
      .limit(200);

    const enriched = await enrichTripRequests(requests);
    return res.json(enriched);
  } catch (err: any) {
    console.error("Error listing dispatch trip requests:", err);
    return res.status(500).json({ message: "Failed to list trip requests" });
  }
}

export async function dispatchApproveTripRequest(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const companyId = getCompanyScope(req);
    const conditions = [eq(tripRequests.id, id)];
    if (companyId) conditions.push(eq(tripRequests.companyId, companyId));

    const [request] = await db.select().from(tripRequests).where(and(...conditions));
    if (!request) return res.status(404).json({ message: "Trip request not found" });

    if (request.status === "APPROVED") {
      return res.json({ message: "Already approved", tripId: request.approvedTripId, request });
    }

    if (request.status === "CANCELLED" || request.status === "REJECTED") {
      return res.status(400).json({ message: `Cannot approve request with status ${request.status}` });
    }

    if (!request.patientId) {
      return res.status(400).json({ message: "Patient must be assigned before approval" });
    }

    const returnNote = req.body.returnNote || null;
    const returnPickupTime = req.body.returnPickupTime || null;
    if (request.isRoundTrip && !returnPickupTime && !returnNote) {
      return res.status(400).json({
        message: "Round trips require either a return pickup time or a return note explaining why a return is not scheduled",
      });
    }

    const mobilityReq = request.serviceLevel === "wheelchair" ? "WHEELCHAIR" : (request.serviceLevel === "stretcher" ? "STRETCHER" : "STANDARD");
    const publicId = await generatePublicId();

    const tripData: any = {
      publicId,
      cityId: request.cityId,
      patientId: request.patientId,
      clinicId: request.clinicId,
      companyId: request.companyId,
      pickupAddress: request.pickupAddress,
      pickupLat: request.pickupLat,
      pickupLng: request.pickupLng,
      dropoffAddress: request.dropoffAddress,
      dropoffLat: request.dropoffLat,
      dropoffLng: request.dropoffLng,
      scheduledDate: request.scheduledDate,
      pickupTime: request.scheduledTime,
      estimatedArrivalTime: "TBD",
      status: "SCHEDULED",
      requestSource: "clinic_portal",
      notes: request.notes,
      mobilityRequirement: mobilityReq,
      passengerCount: request.passengerCount,
    };

    if (request.isRoundTrip) {
      tripData.isRoundTrip = true;
      tripData.returnRequired = !!returnPickupTime;
      if (!returnPickupTime && returnNote) {
        tripData.returnNote = returnNote;
      }
    }

    const trip = await storage.createTrip(tripData);

    let returnTripId: number | null = null;
    if (request.isRoundTrip && returnPickupTime) {
      const returnPublicId = await generatePublicId();
      const returnTrip = await storage.createTrip({
        publicId: returnPublicId,
        cityId: request.cityId,
        patientId: request.patientId,
        clinicId: request.clinicId,
        companyId: request.companyId,
        pickupAddress: request.dropoffAddress,
        pickupLat: request.dropoffLat,
        pickupLng: request.dropoffLng,
        dropoffAddress: request.pickupAddress,
        dropoffLat: request.pickupLat,
        dropoffLng: request.pickupLng,
        scheduledDate: request.scheduledDate,
        pickupTime: returnPickupTime,
        estimatedArrivalTime: "TBD",
        status: "SCHEDULED",
        requestSource: "clinic_portal",
        notes: returnNote || `Return trip for ${publicId}`,
        mobilityRequirement: mobilityReq,
        passengerCount: request.passengerCount,
        isRoundTrip: true,
        pairedTripId: trip.id,
        parentTripId: trip.id,
      } as any);

      returnTripId = returnTrip.id;
      await db.update(trips).set({
        pairedTripId: returnTrip.id,
      } as any).where(eq(trips.id, trip.id));
    }

    await db.update(tripRequests)
      .set({
        status: "APPROVED",
        approvedTripId: trip.id,
        updatedAt: new Date(),
        dispatchNotes: req.body.dispatchNotes || null,
      })
      .where(eq(tripRequests.id, id));

    let autoAssignResult: any = null;
    try {
      const { assignTripAutomatically } = await import("../lib/autoAssignV2Engine");
      autoAssignResult = await assignTripAutomatically(trip.id, "clinic_approve", req.user!.userId);
      if (returnTripId) {
        await assignTripAutomatically(returnTripId, "clinic_approve_return", req.user!.userId);
      }
    } catch (err: any) {
      console.warn("[APPROVE] Auto-assign failed:", err.message);
    }

    return res.json({
      message: "Trip request approved",
      tripId: trip.id,
      returnTripId,
      autoAssign: autoAssignResult || { success: false, reason: "skipped" },
      request: { ...request, status: "APPROVED", approvedTripId: trip.id },
    });
  } catch (err: any) {
    console.error("Error approving trip request:", err);
    return res.status(500).json({ message: "Failed to approve trip request" });
  }
}

export async function dispatchRejectTripRequest(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const companyId = getCompanyScope(req);
    const conditions = [eq(tripRequests.id, id)];
    if (companyId) conditions.push(eq(tripRequests.companyId, companyId));

    const [request] = await db.select().from(tripRequests).where(and(...conditions));
    if (!request) return res.status(404).json({ message: "Trip request not found" });

    if (request.status === "APPROVED") {
      return res.status(400).json({ message: "Cannot reject an already approved request" });
    }

    const [updated] = await db.update(tripRequests)
      .set({
        status: "REJECTED",
        rejectedReason: req.body.reason || null,
        updatedAt: new Date(),
      })
      .where(eq(tripRequests.id, id))
      .returning();

    return res.json(updated);
  } catch (err: any) {
    console.error("Error rejecting trip request:", err);
    return res.status(500).json({ message: "Failed to reject trip request" });
  }
}

export async function dispatchNeedsInfoTripRequest(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const companyId = getCompanyScope(req);
    const conditions = [eq(tripRequests.id, id)];
    if (companyId) conditions.push(eq(tripRequests.companyId, companyId));

    const [request] = await db.select().from(tripRequests).where(and(...conditions));
    if (!request) return res.status(404).json({ message: "Trip request not found" });

    const [updated] = await db.update(tripRequests)
      .set({
        status: "NEEDS_INFO",
        dispatchNotes: req.body.notes || null,
        updatedAt: new Date(),
      })
      .where(eq(tripRequests.id, id))
      .returning();

    if (req.body.message) {
      const [thread] = await db.select().from(chatThreads)
        .where(and(eq(chatThreads.scopeType, "TRIP_REQUEST"), eq(chatThreads.scopeId, id)));

      if (thread) {
        await db.insert(chatMessages).values({
          threadId: thread.id,
          senderUserId: req.user!.userId,
          senderRole: req.user!.role,
          message: req.body.message,
        } as any);
        await db.update(chatThreads).set({ lastMessageAt: new Date() }).where(eq(chatThreads.id, thread.id));
      }
    }

    return res.json(updated);
  } catch (err: any) {
    console.error("Error setting needs-info:", err);
    return res.status(500).json({ message: "Failed to update trip request" });
  }
}

export async function getOrCreateChatThread(req: AuthRequest, res: Response) {
  try {
    const scopeType = req.body.scopeType || "TRIP_REQUEST";
    const scopeId = parseInt(req.body.scopeId);
    if (isNaN(scopeId)) return res.status(400).json({ message: "Invalid scope ID" });

    const [existing] = await db.select().from(chatThreads)
      .where(and(eq(chatThreads.scopeType, scopeType), eq(chatThreads.scopeId, scopeId)));

    if (existing) {
      const clinicId = getClinicScopeId(req);
      const companyScope = getCompanyScope(req);
      if (clinicId && existing.clinicId !== clinicId) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (companyScope && existing.companyId !== companyScope) {
        return res.status(403).json({ message: "Access denied" });
      }
      return res.json(existing);
    }

    return res.status(404).json({ message: "Thread not found" });
  } catch (err: any) {
    console.error("Error getting chat thread:", err);
    return res.status(500).json({ message: "Failed to get chat thread" });
  }
}

export async function getChatMessages(req: AuthRequest, res: Response) {
  try {
    const threadId = parseInt(req.params.threadId as string);
    if (isNaN(threadId)) return res.status(400).json({ message: "Invalid thread ID" });

    const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, threadId));
    if (!thread) return res.status(404).json({ message: "Thread not found" });

    const clinicId = getClinicScopeId(req);
    const companyScope = getCompanyScope(req);
    if (clinicId && thread.clinicId !== clinicId) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (companyScope && thread.companyId !== companyScope) {
      return res.status(403).json({ message: "Access denied" });
    }

    const messages = await db.select().from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(chatMessages.createdAt);

    return res.json(messages);
  } catch (err: any) {
    console.error("Error getting chat messages:", err);
    return res.status(500).json({ message: "Failed to get chat messages" });
  }
}

export async function sendChatMessage(req: AuthRequest, res: Response) {
  try {
    const threadId = parseInt(req.params.threadId as string);
    if (isNaN(threadId)) return res.status(400).json({ message: "Invalid thread ID" });

    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ message: "Message is required" });

    const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, threadId));
    if (!thread) return res.status(404).json({ message: "Thread not found" });

    const clinicId = getClinicScopeId(req);
    const companyScope = getCompanyScope(req);
    if (clinicId && thread.clinicId !== clinicId) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (companyScope && thread.companyId !== companyScope) {
      return res.status(403).json({ message: "Access denied" });
    }

    const [msg] = await db.insert(chatMessages).values({
      threadId,
      senderUserId: req.user!.userId,
      senderRole: req.user!.role,
      message: message.trim(),
    } as any).returning();

    await db.update(chatThreads).set({ lastMessageAt: new Date() }).where(eq(chatThreads.id, threadId));

    return res.status(201).json(msg);
  } catch (err: any) {
    console.error("Error sending chat message:", err);
    return res.status(500).json({ message: "Failed to send message" });
  }
}

export async function clinicCreatePatient(req: AuthRequest, res: Response) {
  try {
    const clinicId = getClinicScopeId(req);
    if (!clinicId) return res.status(403).json({ message: "Clinic scope required" });

    const clinic = await storage.getClinic(clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const { firstName, lastName, phone, address, dateOfBirth, email, notes,
      wheelchairRequired, companyId, cityId, addressStreet, addressCity, addressState, addressZip } = req.body;

    if (!firstName || !lastName) {
      return res.status(400).json({ message: "First name and last name are required" });
    }

    const resolvedCompanyId = clinic.companyId || companyId;
    const resolvedCityId = clinic.cityId || cityId;

    if (!resolvedCompanyId) {
      return res.status(400).json({ message: "Company ID is required" });
    }

    const publicId = await generatePublicId();
    const patient = await storage.createPatient({
      publicId,
      firstName,
      lastName,
      phone: phone || null,
      address: address || null,
      addressStreet: addressStreet || null,
      addressCity: addressCity || null,
      addressState: addressState || null,
      addressZip: addressZip || null,
      dateOfBirth: dateOfBirth || null,
      email: email || null,
      notes: notes || null,
      wheelchairRequired: wheelchairRequired || false,
      clinicId,
      companyId: resolvedCompanyId,
      cityId: resolvedCityId,
      source: "clinic_portal",
    } as any);

    return res.status(201).json(patient);
  } catch (err: any) {
    console.error("Error creating patient:", err);
    return res.status(500).json({ message: "Failed to create patient" });
  }
}

export async function getRequestChatThread(req: AuthRequest, res: Response) {
  try {
    const requestId = parseInt(req.params.id as string);
    if (isNaN(requestId)) return res.status(400).json({ message: "Invalid ID" });

    const [thread] = await db.select().from(chatThreads)
      .where(and(eq(chatThreads.scopeType, "TRIP_REQUEST"), eq(chatThreads.scopeId, requestId)));

    if (!thread) return res.status(404).json({ message: "Thread not found" });

    const clinicId = getClinicScopeId(req);
    const companyScope = getCompanyScope(req);
    if (clinicId && thread.clinicId !== clinicId) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (companyScope && thread.companyId !== companyScope) {
      return res.status(403).json({ message: "Access denied" });
    }

    const messages = await db.select().from(chatMessages)
      .where(eq(chatMessages.threadId, thread.id))
      .orderBy(chatMessages.createdAt);

    return res.json({ thread, messages });
  } catch (err: any) {
    console.error("Error getting request chat:", err);
    return res.status(500).json({ message: "Failed to get chat" });
  }
}

async function enrichTripRequests(requests: any[]) {
  return Promise.all(requests.map(async (r) => {
    const patient = r.patientId ? await storage.getPatient(r.patientId) : null;
    const clinic = await storage.getClinic(r.clinicId);
    const company = await storage.getCompany(r.companyId);
    const cities = await storage.getCities();
    const city = cities.find(c => c.id === r.cityId);
    return {
      ...r,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
      patientPhone: patient?.phone || null,
      clinicName: clinic?.name || null,
      companyName: company?.name || null,
      cityName: city?.name || null,
    };
  }));
}
