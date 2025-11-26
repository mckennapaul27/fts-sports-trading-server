# FTS Sports Trading Server - API Documentation

## Base URL

```
NEXT_PUBLIC_SERVER_URL/api
```

---

## Performance Endpoints

### 1. Get All Systems (for Dropdown)

Get a list of all active systems to populate the system selector dropdown.

**Endpoint:** `GET /api/performance/systems`

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "System 1",
      "slug": "system-1",
      "description": "System description here"
    }
  ]
}
```

**Example Request:**

```javascript
fetch("http://localhost:5001/api/performance/systems")
  .then((res) => res.json())
  .then((data) => console.log(data));
```

---

### 2. Get System Performance Stats

Get comprehensive performance statistics for a specific system. This endpoint provides all the data needed for the home page performance component.

**Endpoint:** `GET /api/performance/stats/:systemId`

**Parameters:**

- `systemId` (URL parameter) - The MongoDB ObjectId of the system

**Response:**

```json
{
  "success": true,
  "data": {
    "systemId": "507f1f77bcf86cd799439011",
    "systemName": "System 1",
    "systemSlug": "system-1",
    "totalPL": 844.0,
    "strikeRate": 67.3,
    "totalBets": 2847,
    "roi": 8.4,
    "cumulativePL": [
      {
        "month": "2024-01",
        "monthName": "January 2024",
        "monthlyPL": 125.5,
        "cumulativePL": 125.5,
        "bets": 245
      },
      {
        "month": "2024-02",
        "monthName": "February 2024",
        "monthlyPL": -45.2,
        "cumulativePL": 80.3,
        "bets": 198
      }
    ],
    "profitByOddsRange": [
      {
        "range": "1.0 - 2.0",
        "minOdds": 1.0,
        "maxOdds": 2.0,
        "profit": 125.5,
        "bets": 245,
        "wins": 180,
        "strikeRate": 73.5
      },
      {
        "range": "2.0 - 3.0",
        "minOdds": 2.0,
        "maxOdds": 3.0,
        "profit": 89.3,
        "bets": 198,
        "wins": 125,
        "strikeRate": 63.1
      },
      {
        "range": "3.0 - 4.0",
        "minOdds": 3.0,
        "maxOdds": 4.0,
        "profit": -12.4,
        "bets": 156,
        "wins": 78,
        "strikeRate": 50.0
      },
      {
        "range": "4.0 - 5.0",
        "minOdds": 4.0,
        "maxOdds": 5.0,
        "profit": 45.2,
        "bets": 134,
        "wins": 67,
        "strikeRate": 50.0
      },
      {
        "range": "5.0 - 6.0",
        "minOdds": 5.0,
        "maxOdds": 6.0,
        "profit": 23.1,
        "bets": 98,
        "wins": 45,
        "strikeRate": 45.9
      },
      {
        "range": "6.0 - 8.0",
        "minOdds": 6.0,
        "maxOdds": 8.0,
        "profit": -15.3,
        "bets": 87,
        "wins": 32,
        "strikeRate": 36.8
      },
      {
        "range": "8.0 - 10.0",
        "minOdds": 8.0,
        "maxOdds": 10.0,
        "profit": 12.5,
        "bets": 65,
        "wins": 22,
        "strikeRate": 33.8
      },
      {
        "range": "10.0+",
        "minOdds": 10.0,
        "maxOdds": null,
        "profit": -8.2,
        "bets": 42,
        "wins": 12,
        "strikeRate": 28.6
      }
    ]
  }
}
```

**Response Fields Explained:**

- **totalPL** (number): Total profit/loss in points. Positive values indicate profit, negative indicate loss.
- **strikeRate** (number): Win percentage (0-100). Calculated as (wins / total bets) × 100
- **totalBets** (number): Total number of bets placed since inception
- **roi** (number): Return on Investment percentage. Calculated as (totalPL / totalBets) × 100
- **cumulativePL** (array): Monthly breakdown with running cumulative totals
  - `month`: Year-month string (e.g., "2024-01")
  - `monthName`: Human-readable month name (e.g., "January 2024")
  - `monthlyPL`: Profit/loss for that specific month
  - `cumulativePL`: Running total from the start up to that month
  - `bets`: Number of bets in that month
- **profitByOddsRange** (array): Profit breakdown by odds ranges
  - `range`: Label for the odds range
  - `minOdds` / `maxOdds`: The odds boundaries
  - `profit`: Total profit/loss for bets in this range
  - `bets`: Number of bets in this range
  - `wins`: Number of winning bets in this range
  - `strikeRate`: Win percentage for this range

**Example Request:**

```javascript
const systemId = "507f1f77bcf86cd799439011";

fetch(`http://localhost:5001/api/performance/stats/${systemId}`)
  .then((res) => res.json())
  .then((data) => {
    console.log("Total P/L:", data.data.totalPL);
    console.log("Strike Rate:", data.data.strikeRate);
    console.log("Total Bets:", data.data.totalBets);
    console.log("ROI:", data.data.roi);
    console.log("Monthly Cumulative:", data.data.cumulativePL);
    console.log("Profit by Odds Range:", data.data.profitByOddsRange);
  });
```

**Error Response (System Not Found):**

```json
{
  "success": false,
  "error": "System not found"
}
```

**Error Response (Server Error):**

```json
{
  "success": false,
  "error": "Error message here"
}
```

---

## Data Usage Guide

### For the Home Page Performance Component:

1. **Initial Load:**

   - First, fetch all systems: `GET /api/performance/systems`
   - Populate the dropdown with the systems
   - Select the first system (or default system) and fetch its stats: `GET /api/performance/stats/:systemId`

2. **When User Changes System:**

   - Fetch new stats: `GET /api/performance/stats/:systemId`
   - Update all displayed metrics

3. **Displaying Data:**
   - **Total P/L**: Display `data.totalPL` with appropriate formatting (e.g., "+844 pts" or "-125 pts")
   - **Strike Rate**: Display `data.strikeRate` as percentage (e.g., "67.3%")
   - **Total Bets**: Display `data.totalBets` as a number (e.g., "2,847")
   - **ROI**: Display `data.roi` as percentage (e.g., "8.4%")
   - **Cumulative P/L Graph**: Use `data.cumulativePL` array to plot the line graph
     - X-axis: Use `monthName` or index
     - Y-axis: Use `cumulativePL` values
   - **Profit by Odds Range**: Use `data.profitByOddsRange` array for the odds analysis tab
     - Can create a bar chart or table showing profit for each range

---

## Notes

- All endpoints return JSON
- All monetary values are in points (1pt level stakes)
- Strike rate is calculated based on results containing "WON" (case-insensitive)
- ROI calculation assumes 1pt level stakes: `(totalPL / totalBets) × 100`
- Monthly cumulative P/L is sorted chronologically
- If a system has no results, all values will be 0 and arrays will be empty
- The API uses CORS, so it can be called from any frontend origin

---

## Example: Complete Home Page Flow

```javascript
// 1. Fetch all systems for dropdown
const systemsResponse = await fetch(
  "http://localhost:5001/api/performance/systems"
);
const systemsData = await systemsResponse.json();
const systems = systemsData.data; // Array of systems

// 2. Get first system's ID (or use selected system)
const selectedSystemId = systems[0]._id;

// 3. Fetch performance stats for selected system
const statsResponse = await fetch(
  `http://localhost:5001/api/performance/stats/${selectedSystemId}`
);
const statsData = await statsResponse.json();
const stats = statsData.data;

// 4. Display the data
console.log("Total P/L:", stats.totalPL); // 844.0
console.log("Strike Rate:", stats.strikeRate); // 67.3
console.log("Total Bets:", stats.totalBets); // 2847
console.log("ROI:", stats.roi); // 8.4

// 5. Plot cumulative P/L graph
stats.cumulativePL.forEach((month) => {
  console.log(`${month.monthName}: ${month.cumulativePL}`);
});

// 6. Display profit by odds range
stats.profitByOddsRange.forEach((range) => {
  console.log(`${range.range}: ${range.profit} pts (${range.bets} bets)`);
});
```
