const System = require("../models/System");
const SystemResult = require("../models/SystemResult");

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

    // Verify system exists
    const system = await System.findById(systemId);
    if (!system) {
      return res.status(404).json({
        success: false,
        error: "System not found",
      });
    }

    // Get all results for this system
    const results = await SystemResult.find({ systemId }).sort({ date: 1 });

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

    // Calculate basic stats
    const totalBets = results.length;
    const totalPL = results.reduce((sum, r) => sum + (r.winPL || 0), 0);

    // Calculate strike rate (wins / total bets)
    const wins = results.filter(
      (r) => r.result && r.result.toUpperCase().includes("LOST")
    ).length;
    const strikeRate = totalBets > 0 ? (wins / totalBets) * 100 : 0;

    // Calculate ROI (assuming 1pt level stakes, ROI = totalPL / totalBets * 100)
    const roi = totalBets > 0 ? (totalPL / totalBets) * 100 : 0;

    // Calculate monthly cumulative P/L
    const monthlyCumulative = calculateMonthlyCumulative(results);

    // Calculate profit by odds range
    const profitByOddsRange = calculateProfitByOddsRange(results);

    res.status(200).json({
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
    });
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

  results.forEach((result) => {
    if (!result.date) return;

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
  });

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
    { label: "1.0 - 2.0", min: 1.0, max: 2.0 },
    { label: "2.0 - 3.0", min: 2.0, max: 3.0 },
    { label: "3.0 - 4.0", min: 3.0, max: 4.0 },
    { label: "4.0 - 5.0", min: 4.0, max: 5.0 },
    { label: "5.0 - 6.0", min: 5.0, max: 6.0 },
    { label: "6.0 - 8.0", min: 6.0, max: 8.0 },
    { label: "8.0 - 10.0", min: 8.0, max: 10.0 },
    { label: "10.0+", min: 10.0, max: Infinity },
  ];

  return ranges.map((range) => {
    const rangeResults = results.filter((r) => {
      if (!r.winBsp) return false;
      return r.winBsp >= range.min && r.winBsp < range.max;
    });

    const profit = rangeResults.reduce((sum, r) => sum + (r.winPL || 0), 0);
    const bets = rangeResults.length;
    const wins = rangeResults.filter(
      (r) => r.result && r.result.toUpperCase().includes("LOST")
    ).length;

    return {
      range: range.label,
      minOdds: range.min,
      maxOdds: range.max === Infinity ? null : range.max,
      profit: Math.round(profit * 100) / 100,
      bets,
      wins,
      strikeRate: bets > 0 ? Math.round((wins / bets) * 100 * 10) / 10 : 0,
    };
  });
}

module.exports = {
  getSystems,
  getSystemPerformance,
};
