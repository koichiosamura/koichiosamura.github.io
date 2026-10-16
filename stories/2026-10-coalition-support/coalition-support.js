// Coalition support page: interactive charts for the companion page of
// Osamura (2026), "Bureaucratic appointments and coalition support in presidential systems", Party Politics.
// Reads the aggregate tables written by osamura_2026_website_data.R from site_data/ next to this page.
(function () {
  "use strict";
  const script = document.currentScript;
  const base = (script && script.dataset.base) || "site_data/";
  const root = document.querySelector(".csr");
  if (!root) return;

  Promise.all([
    fetch(base + "explorer_data.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch(base + "report_extras.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  ]).then(([DATA, EXTRA]) => init(DATA, EXTRA)).catch((err) => {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "The data for these charts could not be loaded (" + err.message + "). Check that the site_data folder sits next to this page and that the page is served by a web server, not opened as a local file.";
    root.prepend(p);
  });

  function init(DATA, EXTRA) {

  // ---------- Data (aggregates written by osamura_2026_website_data.R) ----------
  const D = (s) => new Date(s + "T00:00:00Z");
  const T0 = D("2003-01-01");
  const END = D("2019-01-01");
  const minCell = DATA.meta.min_cell;

  const shortTerm = { "Lula I": "L I", "Lula II": "L II", "Rousseff I": "R I", "Rousseff II": "R II", "Temer": "T" };
  const terms = DATA.terms.map((t) => ({ name: t.term, short: shortTerm[t.term] || t.term, start: D(t.start), end: D(t.end) }));
  const coalitions = DATA.coalitions.map((c) => Object.assign({}, c, { start: D(c.start), end: D(c.end) }));
  const nCoalRC = coalitions.filter((c) => c.has_rollcalls).length;
  const parties = DATA.parties;
  const labelOf = Object.fromEntries(parties.map((p) => [p.party, p.label]));

  const rollcalls = DATA.rollcalls.map((r) =>
    Object.assign({}, r, { date: D(r.date), not: r.n - r.fol, pct: r.fol / r.n }));
  const rcById = Object.fromEntries(rollcalls.map((r) => [r.id, r]));
  const partyRollcalls = DATA.party_rollcalls.map((v) => {
    const rc = rcById[v.id];
    return Object.assign({}, v, { rc, date: rc.date, p: v.fol == null ? null : v.fol / v.n });
  });
  const pcy = DATA.party_coalition_years.map((s) => Object.assign({}, s, { start: D(s.start), end: D(s.end) }));
  const presidents = Array.from(new Set(rollcalls.map((r) => r.president)));

  const flow = EXTRA.data_flow;
  const partySummary = EXTRA.party_summary;
  const centraoOf = Object.fromEntries(partySummary.map((p) => [p.party, p.centrao]));
  const afterElection = Object.fromEntries(EXTRA.rollcall_extra.map((r) => [r.id, r.after_election]));
  const corVars = EXTRA.cor_vars;
  const corLabel = Object.fromEntries(corVars.map((v) => [v.var, v.label]));
  const corMeasure = Object.fromEntries(corVars.map((v) => [v.var, v.measure]));
  const corShort = {
    support: "Support", ministry_share: "Ministerial share", upper_share: "Upper-tier share",
    lower_share: "Lower-tier share", coalition_seats: "Coalition size", coalition_homogeneity: "Coalition homogeneity",
    gov_opp_ideology: "Party ideology", abs_dist_to_president: "Distance to president", cohesion_tenure: "Party cohesion",
    centrao: "Centrão", approval_smoothed: "Approval", after_election_1: "After election",
    months_before_ldo: "Months before BGL", salient_bill: "Bill salience"
  };
  const correlations = EXTRA.correlations;
  const partyYears = EXTRA.party_years;

  // ---------- Formats and shared settings ----------
  const pct0 = d3.format(".0%");
  const pct1 = d3.format(".1%");
  const int = d3.format(",d");
  const r2 = (r) => (r == null ? "n/a" : d3.format("+.2f")(r).replace("-", "−"));
  const fmtMonth = d3.utcFormat("%b %Y");
  const fmtMonthLong = d3.utcFormat("%B %Y");
  const fmtDay = d3.utcFormat("%d %b %Y");
  const fmtMY = d3.utcFormat("%m/%y");
  const mid = (d) => new Date((+d.start + +d.end) / 2);
  const plotStyle = {
    fontFamily: "inherit", fontSize: "11.5px",
    background: "transparent", color: "var(--ink2)", overflow: "visible"
  };
  const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  // Round the followed share and derive the other side from it, so each pair adds up to 100
  const split = (p) => {
    const f = Math.round(p * 100);
    return { f, n: 100 - f };
  };
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- View state ----------
  // The roll-call bars open on the first president, so the page stays short; "All presidents" is in the menu
  const state = {
    party: "PMDB", tier: "lower",
    bparty: "All", bgroup: "president", type: "All", term: presidents[0], topic: "All",
    gby: "president", sort: "support",
    cgroup: "All", cver: "across", cvar: "lower_share"
  };

  // Topics appear only once bill_topics.csv has been added and the data script rerun
  const ementaOf = Object.fromEntries(EXTRA.rollcall_extra.map((r) => [r.id, r.ementa]));
  const topicCounts = d3.rollups(rollcalls.filter((r) => r.topic), (v) => v.length, (r) => r.topic)
    .sort((a, b) => d3.descending(a[1], b[1]) || d3.ascending(a[0], b[0]));
  const topicNames = topicCounts.map((d) => d[0]);
  const hasTopics = topicNames.length > 0;
  const noTopic = "No topic recorded";
  const tiers = [
    { id: "ministry", label: "Ministries", legend: "Share of ministerial posts" },
    { id: "upper", label: "Upper tier (DAS 4–6)", legend: "Share of upper-tier posts (DAS 4–6)" },
    { id: "lower", label: "Lower tier (DAS 1–3)", legend: "Share of lower-tier posts (DAS 1–3)" }
  ];
  const tierLegend = Object.fromEntries(tiers.map((t) => [t.id, t.legend]));
  const typeGroups = [
    { id: "MPV", label: "MPV", name: "MPV (provisional measure)" },
    { id: "PEC", label: "PEC", name: "PEC (constitutional amendment)" },
    { id: "Other", label: "Other types", name: "Other types (PLP, PL, PDC, PRC and others)" }
  ];

  // ---------- Controls ----------
  function buildSeg(id, options, key, onChange) {
    const el = document.getElementById(id);
    el.innerHTML = "";
    options.forEach((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.id = id + "-" + o.id;
      b.textContent = o.label;
      b.setAttribute("aria-pressed", String(state[key] === o.id));
      b.addEventListener("click", () => {
        state[key] = o.id;
        el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        onChange();
      });
      el.appendChild(b);
    });
  }

  buildSeg("csr-seg-party", parties.map((p) => ({ id: p.party, label: p.label })), "party", renderTimeline);
  buildSeg("csr-seg-tier", tiers, "tier", renderTimeline);
  buildSeg("csr-seg-bparty", [{ id: "All", label: "All coalition" }].concat(parties.map((p) => ({ id: p.party, label: p.label }))), "bparty", renderBills);
  buildSeg("csr-seg-type", [{ id: "All", label: "All" }].concat(typeGroups), "type", renderBills);
  buildSeg("csr-seg-gby", [
    { id: "president", label: "President" }, { id: "type", label: "Bill type" },
    { id: "centrao", label: "Centrão" }, { id: "election", label: "Election timing" }
  ], "gby", renderGroups);
  buildSeg("csr-seg-sort", [
    { id: "support", label: "Support" }, { id: "ministry", label: "Ministerial share" },
    { id: "upper", label: "Upper-tier share" }, { id: "lower", label: "Lower-tier share" },
    { id: "dist", label: "Distance to president" }
  ], "sort", renderRanking);
  buildSeg("csr-seg-cver", [{ id: "across", label: "Across party-years" }, { id: "within", label: "Within parties" }], "cver", renderCorrelates);

  const selTerm = document.getElementById("csr-sel-term");
  selTerm.innerHTML = '<option value="All">All presidents</option>' +
    presidents.map((t) => '<option value="' + t + '">' + t + "</option>").join("");
  selTerm.value = state.term;
  selTerm.addEventListener("change", () => { state.term = selTerm.value; renderBills(); });

  if (hasTopics) {
    document.getElementById("csr-field-bgroup").hidden = false;
    document.getElementById("csr-field-topic").hidden = false;
    buildSeg("csr-seg-bgroup", [{ id: "president", label: "President" }, { id: "topic", label: "Topic" }], "bgroup", renderBills);
    const selTopic = document.getElementById("csr-sel-topic");
    selTopic.innerHTML = '<option value="All">All topics</option>' +
      topicNames.map((t) => '<option value="' + esc(t) + '">' + esc(t) + "</option>").join("");
    selTopic.addEventListener("change", () => { state.topic = selTopic.value; renderBills(); });
    document.getElementById("csr-bills-intro").textContent =
      "Each bar is one roll call on an executive bill, split into the share of deputies voting who followed the president (right) and who did not (left). Group the roll calls by president or by topic, and choose a party to see its deputies alone, with a tick marking all coalition parties for comparison. Click a dot in the overview to show only that president's roll calls.";
  }

  const selC = document.getElementById("csr-sel-cgroup");
  selC.innerHTML = '<option value="All">All party-years</option>' +
    presidents.map((t) => '<option value="' + t + '">' + t + "</option>").join("");
  selC.addEventListener("change", () => { state.cgroup = selC.value; renderCorrelates(); });

  // Bill-type legend (shapes match the overview symbols)
  const shapeSvg = {
    MPV: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="var(--ink2)"/></svg>',
    PEC: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" fill="var(--ink2)"/></svg>',
    Other: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 L10.8 10 L1.2 10 Z" fill="var(--ink2)"/></svg>'
  };
  document.getElementById("csr-legend-types").innerHTML =
    typeGroups.map((t) => "<span>" + shapeSvg[t.id] + t.name + "</span>").join("");

  document.getElementById("csr-cap-timeline").textContent =
    "Shares are year totals from the replication data: the party's share of all party-affiliated appointees in that tier, so a column keeps its height within a year. " +
    "Membership follows the coalition flag in the roll-call data. Coalition start dates follow the months in the article's Figure 1. " +
    "Roll calls with fewer than " + minCell + " of the party's deputies voting are not shown.";

  document.getElementById("csr-cap-bills").textContent =
    "Bars show percentages of the coalition deputies voting on each roll call, so every bar adds up to 100%. Labels are rounded so that each pair also sums to 100, and n is the number of deputies voting. " +
    DATA.meta.n_rollcalls_no_direction + " roll calls with no recorded vote direction and " + DATA.meta.n_rollcalls_small +
    " with fewer than " + minCell + " coalition deputies voting are left out. When a party is selected, only roll calls in which it voted as a coalition member appear, and those with fewer than " +
    minCell + " of its deputies voting are hidden. " +
    (hasTopics
      ? "Topics are the Chamber of Deputies' official themes; when a bill has several, the first listed is used."
      : "Roll calls are grouped by president until bills are coded by topic.");

  // ---------- 1. Data card and flow ----------
  function renderFacts() {
    const facts = [
      ["Period", fmtMonthLong(D(flow.first_vote)) + " to " + fmtMonthLong(D(flow.last_vote))],
      ["Presidents", presidents.join(", ")],
      ["Coalitions", flow.coalitions + " periods following the article's Figure 1, " + flow.coalitions_rollcalls + " of them with roll calls"],
      ["Parties", flow.parties_shown + " of the " + flow.parties_coalition + " parties that were ever coalition members"],
      ["Roll calls", flow.rollcalls_shown + " on " + flow.bills_shown + " executive bills"],
      ["Coalition votes", int(flow.votes_shown) + " deputy votes"],
      ["Vote coding", "1 if the deputy followed the president's recommendation, 0 otherwise, including abstentions"],
      ["Appointments", "Party shares of ministerial, upper-tier (DAS 4–6) and lower-tier (DAS 1–3) posts, year totals"],
      ["Sources", "Roll calls from CEBRAP; appointments from ENAP"]
    ];
    document.getElementById("csr-facts").innerHTML = facts.map(([k, v]) => "<div><dt>" + k + "</dt><dd>" + v + "</dd></div>").join("");

    const rows = [
      {
        title: "Roll calls", total: flow.rollcalls,
        parts: [
          { n: flow.rollcalls_shown, label: "shown", cls: "f0" },
          { n: flow.rollcalls_no_direction, label: "no recorded vote direction", cls: "f1" },
          { n: flow.rollcalls_small, label: "fewer than " + minCell + " coalition deputies voting", cls: "f2" }
        ]
      },
      {
        title: "Bills", total: flow.bills,
        parts: [
          { n: flow.bills_shown, label: "shown", cls: "f0" },
          { n: flow.bills - flow.bills_direction, label: "only roll calls without a recorded vote direction", cls: "f1" },
          { n: flow.bills_direction - flow.bills_shown, label: "only roll call too small to show", cls: "f2" }
        ]
      },
      {
        title: "Rows in the replication data", total: flow.rows,
        parts: [
          { n: flow.votes_shown, label: "coalition votes shown", cls: "f0" },
          { n: flow.rows_coalition - flow.votes_coalition_direction, label: "coalition rows without a recorded vote direction", cls: "f1" },
          { n: flow.votes_coalition_direction - flow.votes_shown, label: "in the roll call left out for size", cls: "f2" },
          { n: flow.rows - flow.rows_coalition, label: "opposition rows, not used on this page", cls: "f3" }
        ]
      }
    ];
    document.getElementById("csr-flow").innerHTML = rows.map((r) =>
      '<div class="flow-row"><div class="csr-subhead">' + r.title + "<span>" + int(r.total) + "</span></div>" +
      '<div class="flow-bar" role="img" aria-label="' + r.title + ": " + r.parts.map((p) => int(p.n) + " " + p.label).join(", ") + '">' +
      r.parts.filter((p) => p.n > 0).map((p) => '<i class="' + p.cls + '" style="flex:' + p.n + ' 1 0"></i>').join("") + "</div>" +
      '<div class="flow-key">' + r.parts.filter((p) => p.n > 0).map((p) =>
        '<span><i class="sw ' + p.cls + '" style="width:10px;height:10px;border-radius:2px"></i><b>' + int(p.n) + "</b> " + p.label + "</span>").join("") +
      "</div></div>").join("");
  }

  // ---------- 2. Timeline view ----------
  function addHatch(svg, id) {
    const ns = "http://www.w3.org/2000/svg";
    const defs = document.createElementNS(ns, "defs");
    const pat = document.createElementNS(ns, "pattern");
    pat.setAttribute("id", id);
    pat.setAttribute("patternUnits", "userSpaceOnUse");
    pat.setAttribute("width", "6");
    pat.setAttribute("height", "6");
    pat.setAttribute("patternTransform", "rotate(45)");
    const ln = document.createElementNS(ns, "line");
    ln.setAttribute("x1", "0"); ln.setAttribute("y1", "0");
    ln.setAttribute("x2", "0"); ln.setAttribute("y2", "6");
    ln.setAttribute("style", "stroke: var(--axis); stroke-width: 2");
    pat.appendChild(ln);
    defs.appendChild(pat);
    svg.insertBefore(defs, svg.firstChild);
  }

  function partySegments(pid, tier) {
    return pcy.filter((s) => s.party === pid).map((s) => {
      const share = s.member ? s[tier] : null;
      const mean = s.fol != null ? s.fol / s.n : null;
      const head = s.coalition + ", " + s.year;
      let text;
      if (s.member === null) {
        text = head + "\nNo roll calls in the data for this coalition";
      } else if (!s.member) {
        text = head + "\nNot in the coalition";
      } else {
        text = head + "\n" + tierLegend[tier] + ": " + pct1(share) + " (year total)\n";
        if (s.n_rc === 0) text += "No roll calls with its deputies voting";
        else if (mean == null) text += "Fewer than " + minCell + " of its deputies voting: result withheld";
        else text += "Followed the president: " + pct0(mean) + " of " + int(s.n) + " votes in " + s.n_rc + " roll call" + (s.n_rc > 1 ? "s" : "");
      }
      return Object.assign({}, s, { share, mean, text });
    });
  }

  function renderTimeline() {
    const stripEl = document.getElementById("csr-strip");
    const el = document.getElementById("csr-timeline");
    const w = Math.max(300, el.clientWidth);
    const narrow = w < 640;
    const ml = 44, mr = 14;
    const segs = partySegments(state.party, state.tier);
    const dots = partyRollcalls.filter((v) => v.party === state.party && v.p != null);
    document.getElementById("csr-lg-share").textContent = tierLegend[state.tier];

    const strip = Plot.plot({
      width: w, height: 30, marginLeft: ml, marginRight: mr, marginTop: 2, marginBottom: 2,
      x: { type: "utc", domain: [T0, END], axis: null },
      y: { domain: [0, 1], axis: null },
      style: plotStyle,
      marks: [
        Plot.rect(terms.filter((d, i) => i % 2 === 0), { x1: "start", x2: "end", y1: 0.2, y2: 1, fill: "var(--term-a)", insetLeft: 1, insetRight: 1, rx: 3 }),
        Plot.rect(terms.filter((d, i) => i % 2 === 1), { x1: "start", x2: "end", y1: 0.2, y2: 1, fill: "var(--term-b)", insetLeft: 1, insetRight: 1, rx: 3 }),
        Plot.text(terms, { x: mid, y: 0.6, text: (d) => (narrow ? d.short : d.name), fill: "var(--ink2)", fontWeight: 500 }),
        Plot.ruleX(coalitions, { x: "start", y1: 0, y2: 0.2, stroke: "var(--muted)" })
      ]
    });

    const chart = Plot.plot({
      width: w, height: narrow ? 300 : 360, marginLeft: ml, marginRight: mr, marginTop: 8, marginBottom: 28,
      x: { type: "utc", domain: [T0, END], ticks: d3.utcYear.every(narrow ? 4 : 2), tickFormat: "%Y", label: null },
      y: { domain: [0, 1], grid: true, ticks: 5, tickFormat: pct0, label: null },
      style: plotStyle,
      marks: [
        Plot.rect(segs.filter((s) => s.member === false), { x1: "start", x2: "end", y1: 0, y2: 1, fill: "var(--out)" }),
        Plot.rect(segs.filter((s) => s.member === null), { x1: "start", x2: "end", y1: 0, y2: 1, fill: "url(#csr-hatch-tl)" }),
        Plot.rect(segs.filter((s) => s.member), { x1: "start", x2: "end", y1: 0, y2: "share", fill: "var(--share-wash)", insetLeft: 0.5, insetRight: 0.5 }),
        Plot.ruleY(segs.filter((s) => s.member), { x1: "start", x2: "end", y: "share", stroke: "var(--share)", strokeWidth: 1 }),
        Plot.ruleY([0], { stroke: "var(--axis)" }),
        Plot.dot(dots, { x: "date", y: "p", r: 2.6, fill: "var(--follow-dot)" }),
        Plot.ruleY(segs.filter((s) => s.member && s.mean != null), { x1: "start", x2: "end", y: "mean", stroke: "var(--follow)", strokeWidth: 2.25, strokeLinecap: "round" }),
        Plot.tip(segs, Plot.pointerX({ x: mid, y: (d) => (d.member ? (d.mean ?? d.share) : 0.5), title: "text" }))
      ]
    });
    addHatch(chart, "csr-hatch-tl");

    stripEl.replaceChildren(strip);
    el.replaceChildren(chart);

    const memberCoals = new Set(segs.filter((s) => s.member).map((s) => s.coalition)).size;
    const n = d3.sum(dots, (d) => d.n), f = d3.sum(dots, (d) => d.fol);
    const hidden = partyRollcalls.filter((v) => v.party === state.party && v.fol == null).length;
    document.getElementById("csr-stat-party").innerHTML =
      "<b>" + labelOf[state.party] + "</b> voted as a coalition member in " + memberCoals + " of the " + nCoalRC +
      " coalitions with roll calls in the data. Across the " + dots.length + " roll calls shown, <b>" +
      (n ? pct0(f / n) : "n/a") + "</b> of its deputies' votes followed the president." +
      (hidden ? " " + hidden + " roll call" + (hidden > 1 ? "s" : "") + " with fewer than " + minCell + " of its deputies voting " + (hidden > 1 ? "are" : "is") + " not shown." : "");

    const rows = segs.map((s) =>
      "<tr><td>" + s.coalition + "</td><td>" + s.year + "</td><td>" + (s.member === null ? "No roll calls" : s.member ? "Yes" : "No") + "</td>" +
      '<td class="num">' + (s.member ? pct1(s.share) : "") + "</td>" +
      '<td class="num">' + (s.mean != null ? pct0(s.mean) : "") + "</td>" +
      '<td class="num">' + (s.member && s.n ? int(s.n) : "") + "</td>" +
      '<td class="num">' + (s.member ? s.n_rc : "") + "</td></tr>").join("");
    document.getElementById("csr-tbl-timeline").innerHTML =
      "<table><thead><tr><th>Coalition</th><th>Year</th><th>Member</th>" +
      '<th class="num">' + tierLegend[state.tier] + '</th><th class="num">Followed</th>' +
      '<th class="num">Votes</th><th class="num">Roll calls</th></tr></thead><tbody>' + rows + "</tbody></table>";
  }

  // ---------- 4. Bills view ----------
  const passes = (rc) =>
    (state.type === "All" || rc.type_group === state.type) &&
    (state.term === "All" || rc.president === state.term) &&
    (state.topic === "All" || rc.topic === state.topic);

  function rowsFor(party) {
    const out = [];
    let small = 0;
    if (party === "All") {
      rollcalls.forEach((rc) => out.push({ rc, id: rc.id, n: rc.n, fol: rc.fol, not: rc.not, pct: rc.pct, coalPct: rc.pct }));
    } else {
      partyRollcalls.forEach((v) => {
        if (v.party !== party) return;
        if (v.fol == null) { if (passes(v.rc)) small++; return; }
        out.push({ rc: v.rc, id: v.id, n: v.n, fol: v.fol, not: v.n - v.fol, pct: v.fol / v.n, coalPct: v.rc.pct });
      });
      out.sort((a, b) => a.rc.date - b.rc.date);
    }
    return { rows: out, small };
  }

  const tipRow = (d) => {
    const rc = d.rc;
    const s2 = split(d.pct);
    const who = state.bparty === "All" ? "Coalition deputies" : labelOf[state.bparty] + " deputies";
    let s = rc.bill + " · " + fmtDay(rc.date) + "\n" + (rc.topic ? "Topic: " + rc.topic + "\n" : "") +
      (ementaOf[rc.id] ? ementaOf[rc.id] + "\n" : "") + rc.subject + "\n" + rc.president + ", coalition " + rc.coalition + "\n" +
      who + " voting: " + d.n + "\nFollowed: " + d.fol + " (" + s2.f + "%)\nDid not follow: " + d.not + " (" + s2.n + "%)";
    if (state.bparty !== "All") s += "\nAll coalition parties: " + pct0(d.coalPct) + " followed";
    return s;
  };

  function renderBills() {
    const wrapEl = document.getElementById("csr-overview");
    const w = Math.max(300, wrapEl.clientWidth);
    const narrow = w < 640;
    const party = state.bparty;
    const partyMode = party !== "All";
    const { rows: all, small } = rowsFor(party);
    const sel = all.filter((d) => passes(d.rc));
    const rest = all.filter((d) => !passes(d.rc));

    const overview = Plot.plot({
      width: w, height: narrow ? 210 : 240, marginLeft: 44, marginRight: 14, marginTop: 10, marginBottom: 28,
      x: { type: "utc", domain: [T0, END], ticks: d3.utcYear.every(narrow ? 4 : 2), tickFormat: "%Y", label: null },
      y: { domain: [0, 1], grid: true, ticks: 5, tickFormat: pct0, label: null },
      symbol: { domain: typeGroups.map((t) => t.id), range: ["circle", "square", "triangle"] },
      style: plotStyle,
      marks: [
        Plot.ruleX(terms.slice(1), { x: "start", stroke: "var(--axis)", strokeDasharray: "2,3" }),
        Plot.dot(rest, { x: (d) => d.rc.date, y: "pct", symbol: (d) => d.rc.type_group, r: 4, fill: "var(--muted-dot)", stroke: "var(--surface)", strokeWidth: 1 }),
        Plot.dot(sel, { x: (d) => d.rc.date, y: "pct", symbol: (d) => d.rc.type_group, r: 4.5, fill: "var(--follow)", stroke: "var(--surface)", strokeWidth: 1 }),
        Plot.tip(all, Plot.pointer({ x: (d) => d.rc.date, y: "pct", title: tipRow, maxRadius: 24 }))
      ]
    });
    overview.style.cursor = "pointer";
    overview.addEventListener("click", () => {
      const v = overview.value;
      if (!v) return;
      state.term = v.rc.president;
      selTerm.value = v.rc.president;
      renderBills();
    });
    wrapEl.replaceChildren(overview);

    const n = d3.sum(sel, (d) => d.n), f = d3.sum(sel, (d) => d.fol);
    const nMatch = rollcalls.filter(passes).length;
    let stat;
    if (!partyMode) {
      stat = "Showing <b>" + sel.length + "</b> of " + rollcalls.length + " roll calls" +
        (sel.length ? ". Across them, <b>" + pct0(f / n) + "</b> of coalition deputies' votes followed the president." : ".");
    } else {
      stat = "<b>" + labelOf[party] + "</b> voted as a coalition member in <b>" + sel.length + "</b> of the " + nMatch +
        " roll calls matching these filters" +
        (sel.length ? ". Across them, <b>" + pct0(f / n) + "</b> of its deputies' votes followed the president." : ".") +
        (small ? " " + small + " more " + (small > 1 ? "are" : "is") + " hidden because fewer than " + minCell + " of its deputies voted." : "");
    }
    document.getElementById("csr-stat-bills").innerHTML = stat;
    document.getElementById("csr-lg-coal").hidden = !partyMode;

    const barsEl = document.getElementById("csr-bars");
    const headEl = document.getElementById("csr-axis-head");
    barsEl.replaceChildren();
    if (!sel.length) {
      headEl.hidden = true;
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = partyMode
        ? "No roll calls match these filters while " + labelOf[party] + " was in the coalition. Choose another party, bill type or president."
        : "No roll calls match these filters. Choose another bill type or president.";
      barsEl.appendChild(p);
    } else {
      headEl.hidden = false;
      const ml = narrow ? 112 : 152, mr = 40;
      const plotW = w - ml - mr;
      const room = narrow ? 30 : 36;
      // Fixed scale from 100% to 100%, so the zero line stays in place whatever the filters
      const leftMax = 1;
      const span = (leftMax + 1) / (1 - (2 * room) / plotW);
      const pad = (room * span) / plotW;
      const xLo = -leftMax - pad, xHi = 1 + pad;
      const step = narrow ? 0.5 : 0.2;
      const ticks = d3.range(-Math.floor(leftMax / step + 1e-9), Math.floor(1 / step + 1e-9) + 1)
        .map((k) => Math.round(k * step * 100) / 100);
      const zeroPx = ml + ((0 - xLo) / (xHi - xLo)) * plotW;
      headEl.innerHTML =
        '<span style="right:' + (w - zeroPx + 6) + 'px">← Did not follow</span>' +
        '<span style="left:' + (zeroPx + 6) + 'px">Followed →</span>' +
        '<span style="left:' + (w - mr + 8) + 'px">n</span>';

      const rowLabel = Object.fromEntries(sel.map((d) => [d.id,
        narrow ? d.rc.bill_short + " · " + fmtMY(d.rc.date) : d.rc.bill + " · " + fmtMonth(d.rc.date)]));
      const label = { fill: "var(--ink2)", stroke: "var(--surface)", strokeWidth: 3, paintOrder: "stroke" };

      const byTopic = hasTopics && state.bgroup === "topic";
      const groupNames = byTopic ? topicNames.concat([noTopic]) : presidents;
      const groupOf = (d) => (byTopic ? (d.rc.topic || noTopic) : d.rc.president);
      groupNames.forEach((t) => {
        const tr = sel.filter((d) => groupOf(d) === t);
        if (!tr.length) return;
        const block = document.createElement("div");
        block.className = "group-block";
        const h = document.createElement("div");
        h.className = "csr-subhead";
        h.innerHTML = t + "<span>" + tr.length + " roll call" + (tr.length > 1 ? "s" : "") + "</span>";
        block.appendChild(h);
        const marks = [
          Plot.barX(tr, { y: "id", x1: (d) => -(1 - d.pct), x2: 0, fill: "var(--defect)", rx: 2 }),
          Plot.barX(tr, { y: "id", x1: 0, x2: "pct", fill: "var(--follow)", rx: 2 }),
          Plot.ruleX([0], { stroke: "var(--ink2)" })
        ];
        if (partyMode) marks.push(Plot.tickX(tr, { y: "id", x: "coalPct", stroke: "var(--ink)", strokeWidth: 2 }));
        marks.push(
          Plot.text(tr, { y: "id", x: (d) => (partyMode ? Math.max(d.pct, d.coalPct) : d.pct), text: (d) => split(d.pct).f + "%", dx: 5, textAnchor: "start", ...label }),
          Plot.text(tr.filter((d) => split(d.pct).n > 0), { y: "id", x: (d) => -(1 - d.pct), text: (d) => split(d.pct).n + "%", dx: -5, textAnchor: "end", ...label }),
          Plot.text(tr, { y: "id", x: () => xHi, text: (d) => int(d.n), dx: 8, textAnchor: "start", fill: "var(--muted)" }),
          Plot.tip(tr, Plot.pointerY({ y: "id", x: "pct", title: tipRow }))
        );
        const chart = Plot.plot({
          width: w, height: tr.length * 22 + 30,
          marginLeft: ml, marginRight: mr, marginTop: 4, marginBottom: 24,
          x: { domain: [xLo, xHi], ticks, tickFormat: (d) => pct0(Math.abs(d)), grid: true, label: null },
          y: { domain: tr.map((d) => d.id), tickFormat: (id) => rowLabel[id], tickSize: 0, padding: 0.24, label: null },
          style: plotStyle,
          marks
        });
        block.appendChild(chart);
        barsEl.appendChild(block);
      });
    }

    const group = partyMode ? labelOf[party] : "All coalition";
    const rows = sel.map((d) =>
      "<tr><td>" + fmtDay(d.rc.date) + "</td><td>" + d.rc.bill + "</td>" + (hasTopics ? "<td>" + esc(d.rc.topic || "") + "</td>" : "") +
      "<td>" + esc(d.rc.subject) + "</td><td>" + d.rc.president + "</td><td>" + d.rc.coalition + "</td>" +
      "<td>" + group + '</td><td class="num">' + d.fol + '</td><td class="num">' + d.not + '</td><td class="num">' + d.n +
      '</td><td class="num">' + split(d.pct).f + '%</td><td class="num">' + split(d.pct).n + "%</td>" +
      (partyMode ? '<td class="num">' + pct0(d.coalPct) + "</td>" : "") + "</tr>").join("");
    document.getElementById("csr-tbl-bills").innerHTML =
      "<table><thead><tr><th>Date</th><th>Bill</th>" + (hasTopics ? "<th>Topic</th>" : "") + "<th>Description</th><th>President</th><th>Coalition</th><th>Deputies</th>" +
      '<th class="num">Followed</th><th class="num">Did not follow</th><th class="num">n</th><th class="num">% followed</th><th class="num">% did not follow</th>' +
      (partyMode ? '<th class="num">All coalition %</th>' : "") + "</tr></thead><tbody>" +
      rows + "</tbody></table>";
  }

  // ---------- 5. Rainclouds by group ----------
  const groupDefs = {
    president: { names: presidents, of: (v) => v.rc.president },
    type: { names: ["MPVs", "PECs", "Other bill types"], of: (v) => ({ MPV: "MPVs", PEC: "PECs", Other: "Other bill types" })[v.rc.type_group] },
    centrao: { names: ["Centrão parties", "Other parties"], of: (v) => (centraoOf[v.party] === 1 ? "Centrão parties" : "Other parties") },
    election: { names: ["After a first-round election", "Other periods"], of: (v) => (afterElection[v.id] === 1 ? "After a first-round election" : "Other periods") }
  };

  function kde(values) {
    const bw = 0.025;
    const xs = d3.range(0, 1.0001, 0.005);
    const k = (u) => Math.exp(-0.5 * u * u);
    const ds = xs.map((x) => d3.sum(values, (v) => k((x - v) / bw) + k((x - (2 - v)) / bw) + k((x + v) / bw)));
    const mx = d3.max(ds) || 1;
    return xs.map((x, i) => ({ x, d: ds[i] / mx }));
  }

  function renderGroups() {
    const el = document.getElementById("csr-rain");
    const w = Math.max(300, el.clientWidth);
    const narrow = w < 640;
    const def = groupDefs[state.gby];
    const cells = partyRollcalls.filter((v) => v.p != null).map((v, i) => {
      const rnd = mulberry32(i * 7919 + 17)();
      return { v, p: v.p, group: def.of(v), jy: -0.56 - rnd * 0.38 };
    });
    const names = def.names.filter((g) => cells.some((c) => c.group === g));
    const dens = [], boxes = [], stats = [];
    names.forEach((g) => {
      const vals = cells.filter((c) => c.group === g).map((c) => c.p).sort(d3.ascending);
      kde(vals).forEach((pt) => dens.push({ group: g, x: pt.x, d: pt.d }));
      const q1 = d3.quantileSorted(vals, 0.25), q3 = d3.quantileSorted(vals, 0.75), md = d3.quantileSorted(vals, 0.5);
      const iqr = q3 - q1;
      const lo = d3.min(vals.filter((x) => x >= q1 - 1.5 * iqr));
      const hi = d3.max(vals.filter((x) => x <= q3 + 1.5 * iqr));
      boxes.push({ group: g, q1, q3, md, lo, hi });
      const sub = cells.filter((c) => c.group === g);
      stats.push({
        group: g, n: vals.length, md, mean: d3.mean(vals),
        pooled: d3.sum(sub, (c) => c.v.fol) / d3.sum(sub, (c) => c.v.n),
        below: vals.filter((x) => x < 0.9).length / vals.length
      });
    });
    const labels = stats.map((s) => ({
      group: s.group,
      head: s.group,
      sub: "Average " + pct1(s.mean) + "  ·  " + pct0(s.below) + " below 90%  ·  " + int(s.n) + " party results"
    }));
    const tipCell = (c) => labelOf[c.v.party] + " · " + c.v.rc.bill + " · " + fmtMonth(c.v.rc.date) + "\n" +
      pct0(c.p) + " of " + c.v.n + " deputies voting followed the president";

    const chart = Plot.plot({
      width: w, height: names.length * (narrow ? 140 : 148) + 34,
      marginLeft: 14, marginRight: 14, marginTop: 4, marginBottom: 30,
      x: { domain: [0, 1], ticks: narrow ? 5 : 10, tickFormat: pct0, grid: true, label: null },
      y: { domain: [-1, 1.62], axis: null },
      fy: { domain: names, axis: null, padding: 0.08 },
      style: plotStyle,
      marks: [
        Plot.areaY(dens, { fy: "group", x: "x", y1: 0, y2: "d", fill: "var(--follow-wash)", curve: "basis" }),
        Plot.lineY(dens, { fy: "group", x: "x", y: "d", z: "group", stroke: "var(--follow)", strokeWidth: 1.5, curve: "basis" }),
        Plot.dot(cells, { fy: "group", x: "p", y: "jy", r: 1.8, fill: "var(--follow-dot)" }),
        Plot.ruleY(boxes, { fy: "group", y: () => -0.3, x1: "lo", x2: "hi", stroke: "var(--ink2)" }),
        Plot.rect(boxes, { fy: "group", x1: "q1", x2: "q3", y1: () => -0.42, y2: () => -0.18, fill: "var(--surface)", stroke: "var(--ink2)" }),
        Plot.ruleX(boxes, { fy: "group", x: "md", y1: () => -0.42, y2: () => -0.18, stroke: "var(--ink2)", strokeWidth: 1.5 }),
        Plot.dot(stats, { fy: "group", x: "mean", y: () => -0.3, symbol: "diamond", r: 6.5, fill: "var(--ink)", stroke: "var(--surface)", strokeWidth: 1.5 }),
        Plot.text(labels, { fy: "group", frameAnchor: "top-left", text: "head", dy: 3, fill: "var(--ink)", fontWeight: 600, fontSize: 12.5 }),
        Plot.text(labels, { fy: "group", frameAnchor: "top-left", text: "sub", dy: 19, fill: "var(--ink2)", fontSize: 12 }),
        Plot.tip(cells, Plot.pointer({ fy: "group", x: "p", y: "jy", title: tipCell, maxRadius: 12 }))
      ]
    });
    el.replaceChildren(chart);

    document.getElementById("csr-tbl-groups").innerHTML =
      '<table><thead><tr><th>Group</th><th class="num">Party results</th><th class="num">Average</th>' +
      '<th class="num">Pooled votes</th><th class="num">Below 90%</th><th class="num">Median</th></tr></thead><tbody>' +
      stats.map((s) => "<tr><td>" + s.group + '</td><td class="num">' + int(s.n) + '</td><td class="num">' + pct1(s.mean) +
        '</td><td class="num">' + pct1(s.pooled) + '</td><td class="num">' + pct0(s.below) + '</td><td class="num">' + pct0(s.md) + "</td></tr>").join("") +
      "</tbody></table>";
  }

  // ---------- 6. Party ranking ----------
  // Parties keep one order (overall support, highest first) whatever measure is shown
  const yearRange = "Lowest and highest year in the coalition";
  const metricDefs = {
    support: { head: "Votes", value: (d) => d.support, fmt: pct1, axis: pct0, range: "Range of coalition-year averages (3+ roll calls)" },
    ministry: { head: "Ministerial", value: (d) => d.ministry, fmt: pct1, axis: pct0, range: yearRange },
    upper: { head: "Upper tier", value: (d) => d.upper, fmt: pct1, axis: pct0, range: yearRange },
    lower: { head: "Lower tier", value: (d) => d.lower, fmt: pct1, axis: pct0, range: yearRange },
    dist: { head: "Distance", value: (d) => d.dist, fmt: (x) => x.toFixed(2), axis: (x) => x.toFixed(1), range: yearRange }
  };
  const minMax = (v) => (v.length ? [d3.min(v), d3.max(v)] : [null, null]);
  const rankRows = partySummary.filter((p) => p.fol != null).map((p) => {
    const sup = pcy.filter((s) => s.party === p.party && s.fol != null && s.n_rc >= 3).map((s) => s.fol / s.n);
    const py = partyYears.filter((d) => d.party === p.party);
    const of = (f) => minMax(py.map((d) => d[f]).filter((x) => x != null));
    return Object.assign({}, p, {
      support: p.fol / p.n,
      ranges: { support: minMax(sup), ministry: of("ministry_share"), upper: of("upper_share"), lower: of("lower_share"), dist: of("abs_dist_to_president") }
    });
  }).sort((a, b) => d3.descending(a.support, b.support));

  function renderRanking() {
    const el = document.getElementById("csr-rank");
    const w = Math.max(300, el.clientWidth);
    const narrow = w < 640;
    const m = state.sort;
    const def = metricDefs[m];
    const rows = rankRows.map((d) => Object.assign({}, d, { v: def.value(d), lo: d.ranges[m][0], hi: d.ranges[m][1] }));
    document.getElementById("csr-lg-range").textContent = def.range;

    let domain;
    if (m === "support") {
      domain = [Math.max(0, Math.floor((d3.min(rows, (d) => d.lo ?? d.v) - 0.02) * 10) / 10), 1];
    } else {
      const top = d3.max(rows, (d) => Math.max(d.hi ?? 0, d.v ?? 0));
      domain = [0, top * 1.05];
    }
    const ml = narrow ? 82 : 96, mr = narrow ? 108 : 170;
    const colA = w - mr + 12, colB = w - mr + (narrow ? 64 : 66);
    document.getElementById("csr-rank-head").innerHTML =
      '<span style="left:' + colA + 'px">Support</span><span style="left:' + colB + 'px">' + def.head + "</span>";
    const tipRank = (d) => d.label + (d.centrao ? " (centrão)" : "") +
      "\nFollowed the president: " + pct1(d.support) + " of " + int(d.n) + " votes in " + d.n_rc + " roll calls" +
      (m === "support" ? "" : "\n" + def.head + (m === "dist" ? " to president's party: " : " share, average: ") + (d.v == null ? "n/a" : def.fmt(d.v))) +
      (d.lo != null ? "\n" + def.range + ": " + def.fmt(d.lo) + " to " + def.fmt(d.hi) : "");
    const withV = rows.filter((d) => d.v != null);
    const chart = Plot.plot({
      width: w, height: rows.length * 28 + 40, marginLeft: ml, marginRight: mr, marginTop: 6, marginBottom: 28,
      x: { domain, grid: true, tickFormat: def.axis, ticks: narrow ? 3 : 8, nice: m !== "support", label: null },
      y: { domain: rows.map((d) => d.party), tickFormat: (p) => labelOf[p], tickSize: 0, label: null },
      style: plotStyle,
      marks: [
        Plot.ruleY(rows.filter((d) => d.lo != null), { y: "party", x1: "lo", x2: "hi", stroke: "var(--axis)", strokeWidth: 5, strokeLinecap: "round" }),
        Plot.dot(withV.filter((d) => d.centrao === 1), { y: "party", x: "v", r: 5.5, fill: "var(--ink)", stroke: "var(--surface)", strokeWidth: 1.5 }),
        Plot.dot(withV.filter((d) => d.centrao !== 1), { y: "party", x: "v", r: 5, fill: "var(--surface)", stroke: "var(--ink)", strokeWidth: 1.75 }),
        Plot.text(rows, { y: "party", frameAnchor: "right", dx: 12, text: (d) => pct1(d.support), textAnchor: "start", fill: "var(--ink)", fontWeight: 600 }),
        Plot.text(rows, { y: "party", frameAnchor: "right", dx: colB - colA + 12, text: (d) => (m === "support" ? int(d.n) : d.v == null ? "n/a" : def.fmt(d.v)), textAnchor: "start", fill: "var(--muted)" }),
        Plot.tip(rows, Plot.pointerY({ y: "party", x: (d) => d.v ?? domain[0], title: tipRank }))
      ]
    });
    el.replaceChildren(chart);

    document.getElementById("csr-tbl-rank").innerHTML =
      '<table><thead><tr><th>Party</th><th>Centrão</th><th class="num">Roll calls</th><th class="num">Votes</th><th class="num">Support</th>' +
      '<th class="num">Lowest coalition-year</th><th class="num">Highest coalition-year</th><th class="num">Ministerial</th><th class="num">Upper tier</th><th class="num">Lower tier</th><th class="num">Distance</th></tr></thead><tbody>' +
      rankRows.map((d) => "<tr><td>" + d.label + "</td><td>" + (d.centrao ? "Yes" : "No") + '</td><td class="num">' + d.n_rc + '</td><td class="num">' + int(d.n) +
        '</td><td class="num">' + pct1(d.support) + '</td><td class="num">' + (d.ranges.support[0] != null ? pct0(d.ranges.support[0]) : "") + '</td><td class="num">' + (d.ranges.support[1] != null ? pct0(d.ranges.support[1]) : "") +
        '</td><td class="num">' + pct1(d.ministry) + '</td><td class="num">' + pct1(d.upper) + '</td><td class="num">' + pct1(d.lower) +
        '</td><td class="num">' + (d.dist == null ? "n/a" : d.dist.toFixed(2)) + "</td></tr>").join("") + "</tbody></table>";
  }

  // ---------- 7. Correlates ----------
  const fmtVar = (v, x) => {
    if (x == null) return "n/a";
    if (state.cver === "within") return (x >= 0 ? "+" : "") + (["support", "ministry_share", "upper_share", "lower_share", "after_election_1", "salient_bill"].includes(v) ? (x * 100).toFixed(1) + " pts" : x.toFixed(2));
    if (v === "support" || v === "after_election_1" || v === "salient_bill") return pct0(x);
    if (v.endsWith("_share")) return pct1(x);
    if (v === "coalition_seats") return int(Math.round(x));
    if (v === "centrao") return x ? "Yes" : "No";
    return x.toFixed(2);
  };

  function corrSubset() {
    return correlations.filter((c) => c.version === state.cver && c.group === state.cgroup);
  }

  function scatterData(v) {
    let rows = partyYears.filter((d) => d.support != null && (state.cgroup === "All" || d.president === state.cgroup))
      .map((d) => ({ d, x: d[v], y: d.support }))
      .filter((r) => r.x != null);
    if (state.cver === "within") {
      const mx = d3.rollup(rows, (g) => d3.mean(g, (r) => r.x), (r) => r.d.party);
      const my = d3.rollup(rows, (g) => d3.mean(g, (r) => r.y), (r) => r.d.party);
      rows = rows.map((r) => Object.assign({}, r, { x: r.x - mx.get(r.d.party), y: r.y - my.get(r.d.party) }));
    }
    return rows;
  }

  // Variables keep one order: their correlation with support across all party-years
  const corOrder = correlations
    .filter((c) => c.version === "across" && c.group === "All" && c.var1 === "support" && c.var2 !== "support")
    .sort((a, b) => Math.abs(b.r ?? -1) - Math.abs(a.r ?? -1))
    .map((c) => c.var2);
  // One scale for every selection, wide enough for the largest correlation with support
  const corLim = Math.max(0.5, Math.ceil(d3.max(correlations.filter((c) => c.var1 === "support" && c.var2 !== "support" && c.r != null), (c) => Math.abs(c.r)) * 10 - 1e-9) / 10);

  function renderCorrelates() {
    const rankedEl = document.getElementById("csr-corr-ranked");
    const scatterEl = document.getElementById("csr-corr-scatter");
    const w = Math.max(300, document.getElementById("csr-corr-legend").clientWidth);
    const narrow = w < 640;
    const sub = corrSubset();
    const pos = cssVar("--pos"), neg = cssVar("--neg");

    const withSupport = sub.filter((c) => c.var1 === "support" && c.var2 !== "support");
    const nSupport = d3.max(withSupport, (c) => c.n) || 0;
    document.getElementById("csr-stat-corr").innerHTML =
      "Based on <b>" + nSupport + "</b> party-years" + (state.cgroup === "All" ? "" : " under " + state.cgroup) +
      (state.cver === "within" ? ", comparing each party with its own average." : ".");

    const rows = corOrder.map((v) => {
      const c = withSupport.find((x) => x.var2 === v) || { var2: v, r: null, n: 0 };
      return Object.assign({}, c, { label: corLabel[v] });
    });
    const ok = rows.filter((d) => d.r != null);
    if (!ok.some((d) => d.var2 === state.cvar)) state.cvar = (ok[0] || {}).var2;

    document.getElementById("csr-tbl-corr").innerHTML =
      '<table><thead><tr><th>Variable</th><th>Measured as</th><th class="num">r with support</th><th class="num">Party-years</th></tr></thead><tbody>' +
      rows.map((c) => "<tr><td>" + corLabel[c.var2] + "</td><td>" + corMeasure[c.var2] + '</td><td class="num">' + r2(c.r) + '</td><td class="num">' + c.n + "</td></tr>").join("") +
      "</tbody></table>";

    const lim = corLim;
    const ml = narrow ? 144 : 290;
    // Extra room past both ends so the r labels never reach the variable names
    const ext = lim * (narrow ? 1 : 0.12);
    const half = d3.range(0, lim + 1e-9, narrow ? 0.5 : 0.1).map((t) => Math.round(t * 10) / 10);
    const cTicks = Array.from(new Set(half.map((t) => -t).concat(half))).sort(d3.ascending);
    const chart = Plot.plot({
      width: w, height: rows.length * 26 + 36, marginLeft: ml, marginRight: 46, marginTop: 4, marginBottom: 26,
      x: { domain: [-lim - ext, lim + ext], grid: true, ticks: cTicks, tickFormat: (d) => d3.format("+.1f")(d).replace("+0.0", "0").replace("−0.0", "0"), label: null },
      y: { domain: rows.map((d) => d.var2), tickFormat: (v) => (narrow ? corShort[v] : corLabel[v]), tickSize: 0, padding: 0.28, label: null },
      style: plotStyle,
      marks: [
        Plot.barX(ok.filter((d) => d.r >= 0), { y: "var2", x1: 0, x2: "r", fill: pos, rx: 2 }),
        Plot.barX(ok.filter((d) => d.r < 0), { y: "var2", x1: "r", x2: 0, fill: neg, rx: 2 }),
        Plot.barX(rows.filter((d) => d.var2 === state.cvar && d.r != null), { y: "var2", x1: 0, x2: "r", fill: "none", stroke: "var(--ink)", strokeWidth: 1.5, rx: 2 }),
        Plot.ruleX([0], { stroke: "var(--ink2)" }),
        Plot.text(rows.filter((d) => (d.r ?? 0) >= 0), { y: "var2", x: (d) => d.r ?? 0, text: (d) => r2(d.r), dx: 6, textAnchor: "start", fill: "var(--ink2)" }),
        Plot.text(rows.filter((d) => (d.r ?? 0) < 0), { y: "var2", x: "r", text: (d) => r2(d.r), dx: -6, textAnchor: "end", fill: "var(--ink2)" }),
        Plot.tip(rows, Plot.pointerY({ y: "var2", x: (d) => d.r ?? 0, title: (d) => d.label + "\n" + corMeasure[d.var2] + "\nr = " + r2(d.r) + " across " + d.n + " party-years" }))
      ]
    });
    chart.style.cursor = "pointer";
    chart.addEventListener("click", () => {
      const v = chart.value;
      if (!v || v.r == null) return;
      state.cvar = v.var2;
      renderCorrelates();
    });
    rankedEl.replaceChildren(chart);

    // Scatter for the selected variable
    const v = state.cvar;
    if (!v) { scatterEl.replaceChildren(); return; }
    const pts = scatterData(v);
    const within = state.cver === "within";
    const head = document.createElement("p");
    head.className = "stat";
    const cr = withSupport.find((c) => c.var2 === v);
    head.innerHTML = "<b>" + corLabel[v] + "</b> and support" + (within ? ", as differences from each party's average" : "") + ": r = " + r2(cr && cr.r) + ".";
    const sc = Plot.plot({
      width: w, height: narrow ? 280 : 340, marginLeft: 48, marginRight: 16, marginTop: 28, marginBottom: 40,
      x: { label: corLabel[v] + (within ? " (difference from party average)" : ""), labelAnchor: "center", labelArrow: "none", grid: true, nice: true,
           tickFormat: (!within && (v.endsWith("_share") || v === "after_election_1" || v === "salient_bill")) ? pct0 : undefined },
      y: { label: within ? "Support (difference from party average)" : "Support", labelArrow: "none", grid: true, nice: true, tickFormat: within ? (d) => (d * 100).toFixed(0) + " pts" : pct0 },
      style: plotStyle,
      marks: [
        Plot.dot(pts, { x: "x", y: "y", r: 4, fill: "var(--follow-dot)", stroke: "var(--follow)", strokeWidth: 0.75 }),
        Plot.tip(pts, Plot.pointer({ x: "x", y: "y", title: (r) => labelOf[r.d.party] + " · " + r.d.year + " (" + r.d.president + ")\n" +
          corShort[v] + ": " + fmtVar(v, r.x) + "\nSupport: " + fmtVar("support", r.y) + "\n" + int(r.d.n) + " votes in " + r.d.n_rc + " roll calls" }))
      ]
    });
    scatterEl.replaceChildren(head, sc);
  }

  // ---------- Render and keep width and theme in sync ----------
  function renderAll() {
    renderTimeline();
    renderBills();
    renderGroups();
    renderRanking();
    renderCorrelates();
  }
  renderFacts();
  renderAll();
  let lastW = root.clientWidth;
  let raf = 0;
  new ResizeObserver(() => {
    const wNow = root.clientWidth;
    if (wNow === lastW) return;
    lastW = wNow;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(renderAll);
  }).observe(root);
  // Quarto switches between light and dark themes with a class on <body>; redraw so every colour follows
  new MutationObserver(renderAll).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
})();
