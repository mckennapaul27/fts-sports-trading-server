# Daily Selections API - Frontend Developer Guide

## Overview

This API allows the frontend to fetch and display daily selections. Users can only see selections for systems they are subscribed to. Admin users can create, update, and delete selections through the admin panel.

## Base URL

```
/api/selections
```

## Authentication

### All Endpoints Require Authentication

- **All endpoints** require JWT token in Authorization header
- Format: `Authorization: Bearer <token>`
- Users can only access selections for systems they are subscribed to (systems in their `activeSystemIds`)
- Admin users have access to all systems

### Admin-Only Endpoints

- In addition to authentication, these endpoints require `role: "admin"`
- Admin endpoints: POST, PUT, DELETE operations

---

## User Endpoints (Requires Auth + Subscription)

### 1. Get All Selections

**GET** `/api/selections`

**Headers:**

```
Authorization: Bearer <user_token>
```

**Query Parameters:**

- `systemId` (optional) - Filter by system ID (must be in user's subscribed systems)
- `dateISO` (optional) - Filter by specific date (format: "YYYY-MM-DD")
- `startDate` (optional) - Start date for range (ISO format)
- `endDate` (optional) - End date for range (ISO format)
- `isNew` (optional) - Filter by new selections (true/false)

**Note:** If no `systemId` is provided, returns selections for all systems the user is subscribed to. If `systemId` is provided, user must be subscribed to that system or be an admin.

**Example Request:**

```
GET /api/selections?systemId=6927079fe504d7070a1e2cb3&dateISO=2025-12-10
```

**Example Response:**

```json
{
  "success": true,
  "count": 4,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "systemId": {
        "_id": "6927079fe504d7070a1e2cb3",
        "name": "System 1",
        "slug": "system-1"
      },
      "dateISO": "2025-12-10",
      "date": "2025-12-10T00:00:00.000Z",
      "country": "GB",
      "meeting": "LEICESTER",
      "time": "12:45",
      "horse": "Ronnies Reflection",
      "isNew": true,
      "createdBy": {
        "_id": "507f191e810c19729de860ea",
        "firstName": "Admin",
        "lastName": "User",
        "email": "admin@example.com"
      },
      "createdAt": "2025-12-10T08:00:00.000Z",
      "updatedAt": "2025-12-10T08:00:00.000Z"
    }
  ]
}
```

---

### 2. Get Today's Selections

**GET** `/api/selections/today`

**Headers:**

```
Authorization: Bearer <user_token>
```

**Query Parameters:**

- `systemId` (optional) - Filter by system ID (must be in user's subscribed systems)

**Note:** If no `systemId` is provided, returns today's selections for all systems the user is subscribed to.

**Example Request:**

```
GET /api/selections/today?systemId=6927079fe504d7070a1e2cb3
```

**Example Response:**

```json
{
  "success": true,
  "count": 4,
  "dateISO": "2025-12-10",
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "systemId": {
        "_id": "6927079fe504d7070a1e2cb3",
        "name": "System 1",
        "slug": "system-1"
      },
      "dateISO": "2025-12-10",
      "country": "GB",
      "meeting": "LEICESTER",
      "time": "12:45",
      "horse": "Ronnies Reflection",
      "isNew": true
    }
  ]
}
```

---

### 3. Get Single Selection

**GET** `/api/selections/:id`

**Headers:**

```
Authorization: Bearer <user_token>
```

**Note:** User must be subscribed to the system that this selection belongs to.

**Example Request:**

```
GET /api/selections/507f1f77bcf86cd799439011
```

**Example Response:**

```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "systemId": {
      "_id": "6927079fe504d7070a1e2cb3",
      "name": "System 1",
      "slug": "system-1"
    },
    "dateISO": "2025-12-10",
    "date": "2025-12-10T00:00:00.000Z",
    "country": "GB",
    "meeting": "LEICESTER",
    "time": "12:45",
    "horse": "Ronnies Reflection",
    "isNew": true,
    "createdBy": {
      "_id": "507f191e810c19729de860ea",
      "firstName": "Admin",
      "lastName": "User",
      "email": "admin@example.com"
    },
    "createdAt": "2025-12-10T08:00:00.000Z",
    "updatedAt": "2025-12-10T08:00:00.000Z"
  }
}
```

---

### 4. Mark Selections as Viewed

**PUT** `/api/selections/mark-viewed`

**Headers:**

```
Authorization: Bearer <user_token>
```

**Request Body:**

```json
{
  "selectionIds": ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"], // Optional: specific IDs
  "systemId": "6927079fe504d7070a1e2cb3", // Optional: mark all new for system
  "dateISO": "2025-12-10" // Optional: mark all new for date
}
```

**Note:** You can provide any combination of filters. If you provide `selectionIds`, only those will be marked. Otherwise, all matching selections will be marked.

**Example Response:**

```json
{
  "success": true,
  "updated": 4
}
```

---

## Admin Endpoints (Requires Auth + Admin Role)

### 5. Create Selection

**POST** `/api/selections`

**Headers:**

```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body:**

```json
{
  "systemId": "6927079fe504d7070a1e2cb3",
  "date": "2025-12-10", // Accepts "YYYY-MM-DD" or "DD/MM/YYYY"
  "country": "GB", // Optional
  "meeting": "LEICESTER", // Optional
  "time": "12:45", // Optional
  "horse": "Ronnies Reflection" // Required
}
```

**Example Response:**

```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "systemId": {
      "_id": "6927079fe504d7070a1e2cb3",
      "name": "System 1",
      "slug": "system-1"
    },
    "dateISO": "2025-12-10",
    "date": "2025-12-10T00:00:00.000Z",
    "country": "GB",
    "meeting": "LEICESTER",
    "time": "12:45",
    "horse": "Ronnies Reflection",
    "isNew": true,
    "createdBy": {
      "_id": "507f191e810c19729de860ea",
      "firstName": "Admin",
      "lastName": "User",
      "email": "admin@example.com"
    },
    "createdAt": "2025-12-10T08:00:00.000Z",
    "updatedAt": "2025-12-10T08:00:00.000Z"
  }
}
```

---

### 6. Create Multiple Selections (Bulk)

**POST** `/api/selections/bulk`

**Headers:**

```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body:**

```json
{
  "selections": [
    {
      "systemId": "6927079fe504d7070a1e2cb3",
      "date": "2025-12-10",
      "country": "GB",
      "meeting": "LEICESTER",
      "time": "12:45",
      "horse": "Ronnies Reflection"
    },
    {
      "systemId": "6927079fe504d7070a1e2cb3",
      "date": "2025-12-10",
      "country": "GB",
      "meeting": "HEXHAM",
      "time": "13:55",
      "horse": "King Gris"
    }
  ]
}
```

**Example Response:**

```json
{
  "success": true,
  "created": 2,
  "errors": null,  // Or array of errors if some failed
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "systemId": { ... },
      "dateISO": "2025-12-10",
      "horse": "Ronnies Reflection",
      ...
    },
    {
      "_id": "507f1f77bcf86cd799439012",
      "systemId": { ... },
      "dateISO": "2025-12-10",
      "horse": "King Gris",
      ...
    }
  ]
}
```

---

### 7. Update Selection

**PUT** `/api/selections/:id`

**Headers:**

```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body:**

```json
{
  "date": "2025-12-11", // Optional
  "country": "IRE", // Optional
  "meeting": "CURRAGH", // Optional
  "time": "14:30", // Optional
  "horse": "Updated Horse Name", // Optional
  "isNew": false // Optional: clear new flag
}
```

**Example Response:**

```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "systemId": { ... },
    "dateISO": "2025-12-11",
    "country": "IRE",
    "meeting": "CURRAGH",
    "time": "14:30",
    "horse": "Updated Horse Name",
    "isNew": false,
    ...
  }
}
```

---

### 8. Delete Single Selection

**DELETE** `/api/selections/:id`

**Headers:**

```
Authorization: Bearer <admin_token>
```

**Example Response:**

```json
{
  "success": true,
  "data": {}
}
```

---

### 9. Delete Multiple Selections

**DELETE** `/api/selections`

**Query Parameters:**

- `systemId` (optional) - Delete all selections for system
- `dateISO` (optional) - Delete all selections for date
- `startDate` (optional) - Start date for range
- `endDate` (optional) - End date for range

**Note:** Must provide at least one filter to prevent accidental deletion of all selections.

**Example Request:**

```
DELETE /api/selections?systemId=6927079fe504d7070a1e2cb3&dateISO=2025-12-10
```

**Example Response:**

```json
{
  "success": true,
  "deleted": 4
}
```

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "success": false,
  "error": "Error message here"
}
```

**Common HTTP Status Codes:**

- `200` - Success
- `201` - Created (for POST requests)
- `400` - Bad Request (validation errors, missing required fields)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (not subscribed to system, or not an admin user for admin endpoints)
- `404` - Not Found (resource doesn't exist)
- `500` - Internal Server Error

---

## Frontend Implementation Tips

### 1. Fetching Today's Selections

```javascript
// React example
const fetchTodaySelections = async (systemId, userToken) => {
  try {
    const response = await fetch(
      `/api/selections/today${systemId ? `?systemId=${systemId}` : ""}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      }
    );
    const data = await response.json();
    if (data.success) {
      return data.data;
    }
  } catch (error) {
    console.error("Error fetching selections:", error);
  }
};
```

### 2. Displaying New Selections Indicator

```javascript
// Check for new selections
const hasNewSelections = selections.some((sel) => sel.isNew === true);

// Mark as viewed when user sees them
const markAsViewed = async (selectionIds, userToken) => {
  await fetch("/api/selections/mark-viewed", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ selectionIds }),
  });
};
```

### 3. Admin: Creating Selection

```javascript
// Admin panel - create selection
const createSelection = async (selectionData, adminToken) => {
  try {
    const response = await fetch("/api/selections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(selectionData),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error creating selection:", error);
  }
};
```

### 4. Filtering by Date Range

```javascript
// Get selections for a date range
const getSelectionsByDateRange = async (
  systemId,
  startDate,
  endDate,
  userToken
) => {
  const params = new URLSearchParams({
    systemId,
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
  });

  const response = await fetch(`/api/selections?${params}`, {
    headers: {
      Authorization: `Bearer ${userToken}`,
    },
  });
  const data = await response.json();
  return data.data;
};
```

---

## Data Model Reference

### SystemSelection Object

```typescript
interface SystemSelection {
  _id: string;
  systemId: {
    _id: string;
    name: string;
    slug: string;
  };
  dateISO: string; // "YYYY-MM-DD"
  date: string; // ISO date string
  country?: string;
  meeting?: string;
  time?: string;
  horse: string; // Required
  isNew: boolean; // Default: true
  createdBy?: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
}
```

---

## Notes

1. **Authentication Required**: All endpoints require a valid JWT token. Make sure to include the token in the Authorization header for every request.

2. **System Access Control**: Users can only access selections for systems they are subscribed to (systems in their `activeSystemIds`). If a user tries to access a system they're not subscribed to, they'll receive a 403 Forbidden error.

3. **Admin Access**: Admin users (`role: "admin"`) have access to all systems and can perform CRUD operations.

4. **Date Formats**: The API accepts both "YYYY-MM-DD" and "DD/MM/YYYY" formats for dates, but always returns dates in ISO format ("YYYY-MM-DD").

5. **isNew Flag**: New selections are automatically marked with `isNew: true`. Use this to show notifications or badges in the UI. Mark them as viewed using the `/mark-viewed` endpoint.

6. **Sorting**: Selections are returned sorted by date (descending) and time (ascending) by default.

7. **Populated Fields**: The API automatically populates `systemId` and `createdBy` fields with related data.

8. **Bulk Operations**: Use the bulk endpoint for better performance when creating multiple selections at once.

9. **Error Handling**: Always check the `success` field in responses before using the data. Handle 403 errors gracefully by informing users they need to subscribe to access the system.

---
