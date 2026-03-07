# Driver Profile

## Overview
The Driver Profile feature provides a personal dashboard within the Driver App showing the driver's personal data, company affiliation, vehicle category capability, assigned vehicle, and shift status.

## Source Tables

| Field | Table | Column |
|---|---|---|
| Driver name | `drivers` | `first_name`, `last_name` |
| Phone | `drivers` | `phone` |
| Email | `drivers` | `email` |
| Photo | `drivers` | `photo_url` |
| Vehicle capability | `drivers` | `vehicle_capability` (sedan/wheelchair/both) |
| Company | `companies` | `id`, `name`, `dispatch_phone` |
| City/State | `cities` | `name`, `state` |
| Assigned vehicle | `vehicles` | via `drivers.vehicle_id` FK |
| Shift status | `driver_shifts` | `status` = ACTIVE means ON_SHIFT |
| Profile enabled | `company_settings` | `driver_profile_enabled` (default true) |
| Capability locked | `company_settings` | `lock_driver_capability` (default false) |

## API Endpoints

### GET /api/driver/me
Returns the authenticated driver's full profile.

**Auth**: Bearer token, DRIVER role required.

**Response**:
```json
{
  "user": { "id": 1, "email": "driver@example.com" },
  "driver": {
    "id": 42,
    "publicId": "DRV-00042",
    "displayName": "John Smith",
    "firstName": "John",
    "lastName": "Smith",
    "phone": "+17025551234",
    "email": "driver@example.com",
    "photoUrl": null,
    "vehicleCapability": "sedan",
    "status": "ACTIVE",
    "dispatchStatus": "available",
    "connected": true,
    "company": {
      "id": 1,
      "name": "UCM Las Vegas",
      "cityName": "Las Vegas",
      "stateCode": "NV",
      "dispatchPhone": "+17025559999"
    },
    "assignedVehicle": {
      "id": 10,
      "publicId": "VEH-00010",
      "name": "Van 3",
      "plate": "NV-1234",
      "category": "SEDAN",
      "color": "#6366F1",
      "wheelchairAccessible": false,
      "make": "Toyota",
      "model": "Sienna",
      "year": 2023
    },
    "shift": {
      "status": "ON_SHIFT",
      "startedAt": "2026-02-21T08:00:00.000Z"
    }
  },
  "settings": {
    "driverProfileEnabled": true,
    "lockDriverCapability": false
  }
}
```

### PATCH /api/driver/me
Updates limited driver profile fields.

**Auth**: Bearer token, DRIVER role required.

**Allowed fields**:
| Field | Type | Notes |
|---|---|---|
| `firstName` | string (1-100) | |
| `lastName` | string (1-100) | |
| `phone` | string (5-20) | |
| `photoUrl` | string (URL) or null | |
| `vehicleCapability` | "sedan" / "wheelchair" / "both" | Blocked if `lock_driver_capability = true` |

**Request**:
```json
{
  "firstName": "John",
  "lastName": "Smith",
  "phone": "+17025551234"
}
```

**Response**: `{ "driver": { ...updatedDriver } }`

**Errors**:
- `403` — capability locked by company
- `400` — invalid fields

## RLS / Access Control

| Role | Read own profile | Edit own profile | Read other drivers |
|---|---|---|---|
| DRIVER | Yes (GET /api/driver/me) | Yes (limited fields) | No |
| DISPATCH | Via admin endpoints | No | Own company only |
| COMPANY_ADMIN | Via admin endpoints | No | Own company only |
| SUPER_ADMIN | Via admin endpoints | Via admin endpoints | All |

- Driver endpoints only return the authenticated driver's own data
- `user.driverId` is resolved from JWT, never from URL params
- No cross-driver data exposure

## Feature Flags

| Flag | Table | Default | Effect |
|---|---|---|---|
| `driver_profile_enabled` | `company_settings` | `true` | Hides Profile UI entry point when false |
| `lock_driver_capability` | `company_settings` | `false` | Prevents driver from self-editing vehicleCapability |

## UI Components

### Profile Section (Driver Dashboard Drawer)
- **Header**: Photo circle + name + email + public ID
- **Company Card**: Company name + city/state + dispatch phone
- **Capability Card**: Vehicle category badge + lock indicator
- **Vehicle Card**: Assigned vehicle name, plate, make/model/year, color swatch
- **Shift Card**: ON_SHIFT / OFF_SHIFT badge + start time
- **Edit Profile**: Inline form for first name, last name, phone

### Entry Point
Click the driver profile header in the drawer menu to open the Profile section.

## Schema Migrations

Added columns (non-breaking, with defaults):
```sql
ALTER TABLE drivers ADD COLUMN vehicle_capability text NOT NULL DEFAULT 'sedan';
ALTER TABLE drivers ADD COLUMN photo_url text;
ALTER TABLE company_settings ADD COLUMN driver_profile_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE company_settings ADD COLUMN lock_driver_capability boolean NOT NULL DEFAULT false;
```

## QA Checklist

1. Driver logs in → Profile section visible in drawer menu
2. Company name appears correctly
3. Vehicle capability shows correct value (sedan/wheelchair/both)
4. Assigned vehicle shows correct category and details (if assigned)
5. PATCH firstName updates and persists after refresh
6. Driver cannot access other driver profiles (RLS enforced server-side)
7. If `lock_driver_capability = true`, driver gets 403 when trying to change capability
8. No regression in shift/trip flows
9. Works on iOS PWA + Android PWA
10. Profile section loads with skeleton while fetching

## Postman Collection

**Folder**: "55 - Driver Profile"

### GET /api/driver/me
```
GET {{baseUrl}}/api/driver/me
Authorization: Bearer {{accessToken}}

Tests:
- Status 200
- Has driver.company.name
- vehicleCapability is one of: sedan, wheelchair, both
```

### PATCH /api/driver/me
```
PATCH {{baseUrl}}/api/driver/me
Authorization: Bearer {{accessToken}}
Content-Type: application/json
Body: { "firstName": "Updated", "phone": "+17025550000" }

Tests:
- Status 200
- driver.firstName === "Updated"
```
