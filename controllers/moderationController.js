const Report = require("../models/Report");

exports.getModerationData = async (req, res) => {
  try {
    const { filter } = req.query;

    let dateFilter = {};
    const now = new Date();

    if (filter === "Today") {
      dateFilter = {
        createdAt: {
          $gte: new Date(now.setHours(0, 0, 0, 0)),
        },
      };
    }

    if (filter === "Week") {
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 7);

      dateFilter = {
        createdAt: { $gte: lastWeek },
      };
    }

    const reports = await Report.find(dateFilter)
      .sort({ createdAt: -1 })
      .limit(20);

    const totalReports = await Report.countDocuments(dateFilter);
    const pending = await Report.countDocuments({
      ...dateFilter,
      status: "Pending",
    });
    const resolved = await Report.countDocuments({
      ...dateFilter,
      status: "Resolved",
    });
    const highRisk = await Report.countDocuments({
      ...dateFilter,
      status: "High Risk",
    });

    res.json({
      reports: reports.map((r) => ({
        type: r.type,
        by: r.by,
        target: r.target,
        reason: r.reason,
        status: r.status,
        color: r.color,
        date: r.createdAt.toLocaleString(),
      })),
      totalReports,
      pending,
      resolved,
      highRisk,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};
