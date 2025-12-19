const System = require("../models/System");
const SystemSelection = require("../models/SystemSelection");

function normalizeString(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function parseNumberOrNull(v) {
  const s = normalizeString(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function applyCommonFilters(
  dbQuery,
  query,
  { includeCountry = true, includeMeeting = true, includeOdds = true } = {}
) {
  // Date range filtering
  const startDate = query.startDate;
  const endDate = query.endDate;
  if (startDate || endDate) {
    dbQuery.date = {};
    if (startDate) {
      dbQuery.date.$gte = new Date(startDate);
    }
    if (endDate) {
      // Set to end of day
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dbQuery.date.$lte = end;
    }
  }

  // Country filtering
  if (includeCountry) {
    const country = normalizeString(query.country);
    if (country && country.toLowerCase() !== "all") {
      dbQuery.country = country;
    }
  }

  // Meeting filtering (support either `meeting` or `course` query param)
  if (includeMeeting) {
    const meeting = normalizeString(query.meeting || query.course);
    if (meeting && meeting.toLowerCase() !== "all") {
      dbQuery.meeting = meeting;
    }
  }

  // Odds filtering (winBsp is the odds field)
  if (includeOdds) {
    const minOdds = parseNumberOrNull(query.minOdds);
    const maxOdds = parseNumberOrNull(query.maxOdds);
    if (minOdds !== null || maxOdds !== null) {
      dbQuery.winBsp = {};
      if (minOdds !== null) dbQuery.winBsp.$gte = minOdds;
      if (maxOdds !== null) dbQuery.winBsp.$lte = maxOdds;
    }
  }
}

// @desc    Get all systems for dropdown
// @route   GET /api/performance/systems
// @access  Public
const getSystems = async (req, res) => {
  try {
    const systems = await System.find({ isActive: true })
      .select("_id name slug description")
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      data: systems,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get performance stats for a system
// @route   GET /api/performance/stats/:systemId
// @access  Public
const getSystemPerformance = async (req, res) => {
  try {
    const { systemId } = req.params;
    const query = req.query;
    // console.log("query in getSystemPerformance", query);

    // Verify system exists
    const system = await System.findById(systemId);
    // console.log("system", system);
    if (!system) {
      return res.status(404).json({
        success: false,
        error: "System not found",
      });
    }

    // Build query - only get selections with results
    const dbQuery = { systemId, hasResult: true };
    applyCommonFilters(dbQuery, query);
    // console.log("dbQuery", dbQuery);

    // Get only the fields we need and use lean() for plain JS objects (saves memory)
    const results = await SystemSelection.find(dbQuery)
      .select("date winPL result winBsp")
      .sort({ date: 1 })
      .lean();

    if (!results.length) {
      return res.status(200).json({
        success: true,
        data: {
          systemId,
          systemName: system.name,
          systemSlug: system.slug,
          totalPL: 0,
          strikeRate: 0,
          totalBets: 0,
          roi: 0,
          cumulativePL: [],
          profitByOddsRange: [],
        },
      });
    }

    // Calculate basic stats in a single pass
    let totalPL = 0;
    let wins = 0;
    const totalBets = results.length;

    for (const r of results) {
      const pl = r.winPL || 0;
      totalPL += pl;
      if (r.result && r.result.toUpperCase().includes("LOST")) {
        wins++;
      }
    }

    const strikeRate = totalBets > 0 ? (wins / totalBets) * 100 : 0;
    const roi = totalBets > 0 ? (totalPL / totalBets) * 100 : 0;

    // Calculate monthly cumulative P/L
    const monthlyCumulative = calculateMonthlyCumulative(results);

    // Calculate profit by odds range
    const profitByOddsRange = calculateProfitByOddsRange(results);

    const toSend = {
      success: true,
      data: {
        systemId,
        systemName: system.name,
        systemSlug: system.slug,
        totalPL: Math.round(totalPL * 100) / 100, // Round to 2 decimal places
        strikeRate: Math.round(strikeRate * 10) / 10, // Round to 1 decimal place
        totalBets,
        roi: Math.round(roi * 10) / 10, // Round to 1 decimal place
        cumulativePL: monthlyCumulative,
        profitByOddsRange,
      },
    };
    // console.log("toSend", JSON.stringify(toSend, null, 2));

    res.status(200).json(toSend);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Calculate monthly cumulative P/L
 * Groups results by month and calculates running total
 */
function calculateMonthlyCumulative(results) {
  // Group by year-month
  const monthlyData = {};

  for (const result of results) {
    if (!result.date) continue;

    const date = new Date(result.date);
    const yearMonth = `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}`;

    if (!monthlyData[yearMonth]) {
      monthlyData[yearMonth] = {
        month: yearMonth,
        monthName: date.toLocaleString("default", {
          month: "long",
          year: "numeric",
        }),
        pl: 0,
        bets: 0,
      };
    }

    monthlyData[yearMonth].pl += result.winPL || 0;
    monthlyData[yearMonth].bets += 1;
  }

  // Convert to array and calculate cumulative
  const monthlyArray = Object.values(monthlyData).sort((a, b) =>
    a.month.localeCompare(b.month)
  );

  let cumulative = 0;
  return monthlyArray.map((month) => {
    cumulative += month.pl;
    return {
      month: month.month,
      monthName: month.monthName,
      monthlyPL: Math.round(month.pl * 100) / 100,
      cumulativePL: Math.round(cumulative * 100) / 100,
      bets: month.bets,
    };
  });
}

/**
 * Calculate profit by odds range
 * Groups results by odds ranges and calculates total profit for each range
 */
function calculateProfitByOddsRange(results) {
  const ranges = [
    { label: "Odds < 10.0", max: 10.0 },
    { label: "Odds < 20.0", max: 20.0 },
    { label: "Odds < 30.0", max: 30.0 },
    { label: "All Odds", max: Infinity },
  ];

  // Pre-calculate stats for each range in a single pass
  const rangeStats = ranges.map(() => ({
    profit: 0,
    bets: 0,
    wins: 0,
    sumOdds: 0,
    oddsCount: 0,
  }));

  // Single pass through results
  for (const r of results) {
    const pl = r.winPL || 0;
    const isWin = r.result && r.result.toUpperCase().includes("LOST");
    const odds = r.winBsp;

    // Process each range
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      let include = false;

      if (range.max === Infinity) {
        include = true; // "All Odds" includes everything
      } else if (odds && odds <= range.max) {
        include = true;
      }

      if (include) {
        rangeStats[i].profit += pl;
        rangeStats[i].bets += 1;
        if (isWin) {
          rangeStats[i].wins += 1;
        }
        if (odds) {
          rangeStats[i].sumOdds += odds;
          rangeStats[i].oddsCount += 1;
        }
      }
    }
  }

  // Build response
  return ranges.map((range, i) => {
    const stats = rangeStats[i];
    const avgOdds = stats.oddsCount > 0 ? stats.sumOdds / stats.oddsCount : 0;

    return {
      range: range.label,
      minOdds: 1.0, // All ranges start from 1.0 (minimum betting odds)
      maxOdds: range.max === Infinity ? null : range.max,
      profit: Math.round(stats.profit * 100) / 100,
      bets: stats.bets,
      wins: stats.wins,
      strikeRate:
        stats.bets > 0
          ? Math.round((stats.wins / stats.bets) * 100 * 10) / 10
          : 0,
      avgOdds: Math.round(avgOdds * 100) / 100, // Round to 2 decimal places
    };
  });
}

// @desc    Get all systems with performance stats
// @route   GET /api/performance/all-systems
// @access  Public
const getAllSystemsWithStats = async (req, res) => {
  try {
    // Get all active systems
    const systems = await System.find({ isActive: true }).sort({ name: 1 });

    // Calculate stats for each system using aggregation pipeline (much more memory efficient)
    const systemsWithStats = await Promise.all(
      systems.map(async (system) => {
        // Use aggregation pipeline to calculate stats in database (avoids loading all data)
        const stats = await SystemSelection.aggregate([
          {
            $match: {
              systemId: system._id,
              hasResult: true,
            },
          },
          {
            $group: {
              _id: null,
              totalBets: { $sum: 1 },
              totalPL: { $sum: { $ifNull: ["$winPL", 0] } },
              wins: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$result", null] },
                        {
                          $regexMatch: {
                            input: "$result",
                            regex: /LOST/i,
                          },
                        },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]);

        const statsData = stats[0] || {
          totalBets: 0,
          totalPL: 0,
          wins: 0,
        };

        const totalBets = statsData.totalBets;
        const totalPL = statsData.totalPL;
        const wins = statsData.wins;
        const strikeRate = totalBets > 0 ? (wins / totalBets) * 100 : 0;
        const roi = totalBets > 0 ? (totalPL / totalBets) * 100 : 0;

        const toSend = {
          systemId: system._id,
          systemName: system.name,
          systemSlug: system.slug,
          description: system.description,
          totalPL: totalPL.toFixed(2),
          strikeRate,
          roi,
          totalBets,
        };
        // console.log("toSend", toSend);

        return toSend;
      })
    );

    res.status(200).json({
      success: true,
      data: systemsWithStats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get individual bet records for a system
// @route   GET /api/performance/results/:systemId
// @access  Public
const getSystemResults = async (req, res) => {
  try {
    const { systemId } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    // Verify system exists
    const system = await System.findById(systemId);
    if (!system) {
      return res.status(404).json({
        success: false,
        error: "System not found",
      });
    }

    // Build query - only get selections with results
    const query = { systemId, hasResult: true };
    applyCommonFilters(query, req.query);

    // Parse limit and offset
    const limitNum = parseInt(limit, 10);
    const offsetNum = parseInt(offset, 10);

    // Always sort by rowOrder ascending to maintain Google Sheets order
    // Fallback to date/time for older records without rowOrder
    const sortObj = {
      rowOrder: -1, // Ascending to match Google Sheets (top to bottom)
    };

    // console.log("query", query);
    // console.log("sortObj", sortObj);
    // Get total count
    const total = await SystemSelection.countDocuments(query);

    // Get results with pagination - only select fields we need and use lean() for memory efficiency
    const results = await SystemSelection.find(query)
      .select(
        "dateISO country meeting time horse result winBsp winPL runningWinPL"
      )
      .sort(sortObj)
      .skip(offsetNum)
      .limit(limitNum)
      .lean();

    // Map to response format
    const mappedResults = results.map((result) => {
      const stake = 1.0; // Assuming 1pt level stakes
      const bsp = result.winBsp || 0;
      // For lay bets: liability = (bsp - 1) * stake
      const liability = bsp > 0 ? (bsp - 1) * stake : 0;

      return {
        date: result.dateISO,
        country: result.country || null,
        course: result.meeting || null,
        time: result.time || null,
        selection: result.horse || null,
        result: result.result || null,
        bsp: bsp,
        stake: stake,
        liability: Math.round(liability * 100) / 100,
        pl: Math.round((result.winPL || 0) * 100) / 100,
        runningPL: Math.round((result.runningWinPL || 0) * 100) / 100,
      };
    });

    // Calculate if there are more results
    const hasMore = offsetNum + limitNum < total;
    const nextOffset = hasMore ? offsetNum + limitNum : null;

    res.status(200).json({
      success: true,
      data: {
        results: mappedResults,
        total,
        hasMore,
        nextOffset,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get monthly breakdown for a system (non-cumulative)
// @route   GET /api/performance/monthly/:systemId
// @access  Public
const getMonthlyBreakdown = async (req, res) => {
  try {
    const { systemId } = req.params;

    // Verify system exists
    const system = await System.findById(systemId);
    if (!system) {
      return res.status(404).json({
        success: false,
        error: "System not found",
      });
    }

    // Build query - only get selections with results
    const query = { systemId, hasResult: true };
    applyCommonFilters(query, req.query);

    // Get only the fields we need and use lean() for plain JS objects (saves memory)
    const results = await SystemSelection.find(query)
      .select("date winPL result")
      .sort({ date: 1 })
      .lean();

    // Group by month and calculate monthly P/L (non-cumulative)
    const monthlyData = {};

    for (const result of results) {
      if (!result.date) continue;

      const date = new Date(result.date);
      const yearMonth = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`;

      if (!monthlyData[yearMonth]) {
        monthlyData[yearMonth] = {
          month: yearMonth,
          monthName: date.toLocaleString("default", {
            month: "long",
            year: "numeric",
          }),
          monthlyPL: 0,
          bets: 0,
          wins: 0,
        };
      }

      monthlyData[yearMonth].monthlyPL += result.winPL || 0;
      monthlyData[yearMonth].bets += 1;

      // Count wins (for lay bets, "LOST" = win)
      if (result.result && result.result.toUpperCase().includes("LOST")) {
        monthlyData[yearMonth].wins += 1;
      }
    }

    // Convert to array and calculate strike rate
    const monthlyArray = Object.values(monthlyData)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((month) => ({
        month: month.month,
        monthName: month.monthName,
        monthlyPL: Math.round(month.monthlyPL * 100) / 100,
        bets: month.bets,
        wins: month.wins,
        strikeRate:
          month.bets > 0
            ? Math.round((month.wins / month.bets) * 100 * 10) / 10
            : 0,
      }));

    res.status(200).json({
      success: true,
      data: {
        systemId,
        systemName: system.name,
        systemSlug: system.slug,
        monthlyBreakdown: monthlyArray,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get distinct filter options for a system
// @route   GET /api/performance/filters/:systemId
// @access  Public
//
// Notes:
// - Applies date/odds filters (startDate/endDate/minOdds/maxOdds) so dropdowns stay relevant.
// - Does NOT apply country/meeting filters when building the distinct sets.
const getSystemFilterOptions = async (req, res) => {
  try {
    const { systemId } = req.params;

    // Verify system exists
    const system = await System.findById(systemId);
    if (!system) {
      return res.status(404).json({
        success: false,
        error: "System not found",
      });
    }

    const query = { systemId, hasResult: true };
    applyCommonFilters(query, req.query, {
      includeCountry: false,
      includeMeeting: false,
      includeOdds: true,
    });

    const [countriesRaw, meetingsRaw] = await Promise.all([
      SystemSelection.distinct("country", query),
      SystemSelection.distinct("meeting", query),
    ]);

    const countries = (countriesRaw || [])
      .map((v) => normalizeString(v))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const meetings = (meetingsRaw || [])
      .map((v) => normalizeString(v))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    res.status(200).json({
      success: true,
      data: {
        systemId,
        systemName: system.name,
        systemSlug: system.slug,
        countries,
        meetings,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  getSystems,
  getSystemPerformance,
  getAllSystemsWithStats,
  getSystemResults,
  getMonthlyBreakdown,
  getSystemFilterOptions,
};
