// Brazil runoff map: one dot per polling address, drawn with MapLibre GL JS.
// index.qmd loads MapLibre from jsDelivr before this file. Fonts and interface colours
// come from runoff-map.css (and through it from the site theme); the map colours are here.
(() => {
  // ---- Settings ----------------------------------------------------------------
  const CONFIG = {
    data: "site_data/addresses_round2.tsv",
    style: "https://tiles.openfreemap.org/styles/positron",   // free, no key; attribution is added automatically
    candA: "Lula",      // column a, shown in red
    candB: "Flávio",    // column b, shown in blue
    // Lula's share of the two-candidate vote at each colour; between them colours blend
    stops:   [0.30, 0.40, 0.45, 0.50, 0.55, 0.60, 0.70],
    colours: ["#104281", "#2a78d6", "#86b6ef", "#a3a29c", "#ef9593", "#e34948", "#a51e22"],
    // Base map land and water in light tints of the site colour (#2C3E4F)
    land:  "#f7f8f9",
    water: "#dce2e7",
    brazil: [[-74.0, -33.8], [-34.7, 5.3]],
    // The 27 capitals for the "Go to" menu: name, state, longitude and latitude of the
    // municipal seat (IBGE), and the zoom level that fits the city on the map
    capitals: [
      ["Aracaju", "SE", -37.0677, -10.9091, 11.5],
      ["Belém", "PA", -48.4898, -1.4554, 11],
      ["Belo Horizonte", "MG", -43.9266, -19.9102, 11],
      ["Boa Vista", "RR", -60.6753, 2.8238, 11.5],
      ["Brasília", "DF", -47.9297, -15.7795, 9.5],
      ["Campo Grande", "MS", -54.6295, -20.4486, 11],
      ["Cuiabá", "MT", -56.0974, -15.6010, 11],
      ["Curitiba", "PR", -49.2646, -25.4195, 10.5],
      ["Florianópolis", "SC", -48.5477, -27.5945, 10.5],
      ["Fortaleza", "CE", -38.5423, -3.7166, 11],
      ["Goiânia", "GO", -49.2643, -16.6864, 11],
      ["João Pessoa", "PB", -34.8641, -7.1151, 11.5],
      ["Macapá", "AP", -51.0694, 0.0349, 11.5],
      ["Maceió", "AL", -35.7350, -9.6660, 11.5],
      ["Manaus", "AM", -60.0212, -3.1187, 10.5],
      ["Natal", "RN", -35.1986, -5.7936, 11.5],
      ["Palmas", "TO", -48.3558, -10.2400, 11.5],
      ["Porto Alegre", "RS", -51.2065, -30.0318, 10.5],
      ["Porto Velho", "RO", -63.8999, -8.7608, 11.5],
      ["Recife", "PE", -34.8771, -8.0467, 11],
      ["Rio Branco", "AC", -67.8243, -9.9750, 11.5],
      ["Rio de Janeiro", "RJ", -43.2003, -22.9129, 10],
      ["Salvador", "BA", -38.5011, -12.9718, 11],
      ["São Luís", "MA", -44.2825, -2.5387, 11],
      ["São Paulo", "SP", -46.6395, -23.5329, 10],
      ["Teresina", "PI", -42.8034, -5.0919, 11],
      ["Vitória", "ES", -40.3128, -20.3155, 12]
    ]
  };

  const root = document.getElementById("vm-root");
  const status = document.getElementById("vm-status");

  // ---- Legend --------------------------------------------------------------------
  // The bar gives each threshold an equal stretch, with a tie in the middle,
  // matching the static map's legend.
  const pos = [1, 2, 3, 3.5, 4, 5, 6].map(x => (x / 7 * 100).toFixed(2) + "%");
  document.getElementById("vm-bar").style.background =
    "linear-gradient(to right, " + CONFIG.colours[0] + " 0%, " +
    CONFIG.colours.map((c, i) => c + " " + pos[i]).join(", ") +
    ", " + CONFIG.colours[6] + " 100%)";
  document.getElementById("vm-left").textContent = "← " + CONFIG.candB;
  document.getElementById("vm-right").textContent = CONFIG.candA + " →";
  const ticks = document.getElementById("vm-ticks");
  ["70%", "60%", "55%", "55%", "60%", "70%"].forEach((label, i) => {
    const t = document.createElement("span");
    t.textContent = label;
    t.style.left = ((i + 1) / 7 * 100) + "%";
    ticks.appendChild(t);
  });

  if (typeof maplibregl === "undefined") {
    status.textContent = "The map library couldn't be loaded. Check your connection and reload the page.";
    return;
  }

  // ---- Map ---------------------------------------------------------------------------
  const map = new maplibregl.Map({
    container: "vm-map",
    style: CONFIG.style,
    bounds: CONFIG.brazil,
    fitBoundsOptions: { padding: 20 },
    minZoom: 2.5,
    maxZoom: 16,
    cooperativeGestures: true,      // the page scrolls normally; Ctrl/⌘ + scroll or two fingers zoom the map
    attributionControl: false
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.FullscreenControl({ container: root }), "top-right");   // legend and menu included
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Results: TSE" }));

  // Dot radius grows with zoom; within a zoom level its area is proportional to valid votes
  const radius = k => ["max", 0.8, ["*", k, ["sqrt", ["get", "v"]]]];
  const colourExpr = ["interpolate", ["linear"], ["get", "s"]]
    .concat(CONFIG.stops.flatMap((s, i) => [s, CONFIG.colours[i]]));

  // Columns: lon, lat, sections, places, municipality, place, then the runoff
  // (a2, b2, blank2, null2, absent2) and the first round (a1, b1, valid1, blank1, null1,
  // absent1; empty where the sections changed between rounds). Older files with only
  // a and b still work; the details box then shows the two candidates only.
  const parseTSV = text => {
    const lines = text.trim().split("\n");
    const head = lines[0].split("\t");
    const col = (...names) => { const i = names.map(n => head.indexOf(n)).find(j => j >= 0); return i === undefined ? -1 : i; };
    const idx = {
      lon: col("lon"), lat: col("lat"), n: col("sections"), p: col("places"), m: col("municipality"), l: col("place"),
      a: col("a2", "a"), b: col("b2", "b"), bl2: col("blank2"), nu2: col("null2"), ab2: col("absent2"),
      a1: col("a1"), b1: col("b1"), va1: col("valid1"), bl1: col("blank1"), nu1: col("null1"), ab1: col("absent1")
    };
    const num = (c, i) => (i < 0 || c[i] === undefined || c[i] === "") ? null : +c[i];
    const features = [];
    for (let r = 1; r < lines.length; r++) {
      const c = lines[r].split("\t");
      const a = num(c, idx.a), b = num(c, idx.b);
      if (!(a + b > 0)) continue;
      const props = { a, b, v: a + b, s: a / (a + b), n: num(c, idx.n), p: num(c, idx.p),
                      m: c[idx.m] || "", l: c[idx.l] || "" };
      ["bl2", "nu2", "ab2", "a1", "b1", "va1", "bl1", "nu1", "ab1"].forEach(k => {
        const x = num(c, idx[k]);
        if (x !== null) props[k] = x;      // missing values are left out
      });
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [num(c, idx.lon), num(c, idx.lat)] },
                      properties: props });
    }
    return { type: "FeatureCollection", features };
  };

  const dataPromise = fetch(CONFIG.data)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(parseTSV);

  // Tint the base map's land and water with the site colour. Layer names differ between
  // base map styles, so this only touches layers it recognises and skips the rest.
  const tintBaseMap = () => {
    map.getStyle().layers.forEach(l => {
      try {
        if (l.type === "background") map.setPaintProperty(l.id, "background-color", CONFIG.land);
        else if (l.type === "fill" && /water|ocean|lake|river/i.test(l.id)) map.setPaintProperty(l.id, "fill-color", CONFIG.water);
      } catch (e) { /* leave this layer as it is */ }
    });
  };

  map.on("load", async () => {
    tintBaseMap();
    let data;
    try {
      data = await dataPromise;
    } catch (err) {
      status.textContent = "Couldn't load the data file. Open this page through the website or quarto preview, not as a local file.";
      return;
    }
    map.addSource("votes", { type: "geojson", data });

    // Put the dots under the base map's labels, so place names stay readable
    const firstLabel = map.getStyle().layers.find(l => l.type === "symbol");
    map.addLayer({
      id: "votes",
      type: "circle",
      source: "votes",
      layout: { "circle-sort-key": ["-", ["get", "v"]] },   // big dots underneath small ones
      paint: {
        "circle-color": colourExpr,
        "circle-radius": ["interpolate", ["linear"], ["zoom"],
          3, radius(0.028), 6, radius(0.05), 9, radius(0.09), 12, radius(0.18), 15, radius(0.35)],
        "circle-opacity": 0.82,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 6, 0, 11, 0.7],
        "circle-stroke-opacity": 0.8
      }
    }, firstLabel ? firstLabel.id : undefined);

    status.hidden = true;
  });

  // ---- Details on hover (mouse) or tap (touch) ---------------------------------------
  // Percentages as the TSE reports them: candidates as a share of valid votes, blank and
  // null as a share of votes cast, absentees as a share of registered voters. Changes from
  // the first round are in votes and percentage points.
  const fmt = new Intl.NumberFormat("en-US");
  const pct = x => (100 * x).toFixed(1) + "%";
  const signed = (x, text) => (x > 0 ? "+" : x < 0 ? "\u2212" : "") + text;     // proper minus sign
  const voteChange = d => signed(d, fmt.format(Math.abs(d)));
  const shareChange = d => { const r = Math.round(d * 1000) / 10; return signed(r, Math.abs(r).toFixed(1) + "%"); };   // percentage points
  const esc = s => String(s).replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const swatch = c => '<span class="vm-swatch" style="background:' + (c || "transparent") + '"></span>';
  const known = x => typeof x === "number" && isFinite(x);

  const popupHTML = p => {
    const full = known(p.bl2) && known(p.nu2) && known(p.ab2);          // blank, null and absent in the file
    const cast2 = p.v + (p.bl2 || 0) + (p.nu2 || 0);
    const reg2 = cast2 + (p.ab2 || 0);
    const first = full && known(p.a1) && known(p.b1) && known(p.va1) && known(p.bl1) && known(p.nu1) && known(p.ab1);
    const cast1 = first ? p.va1 + p.bl1 + p.nu1 : NaN;
    const reg1 = first ? cast1 + p.ab1 : NaN;

    // [label, colour, runoff votes, runoff share, first-round votes, first-round share]
    const candidates = [
      [CONFIG.candA, CONFIG.colours[5], p.a, p.a / p.v, p.a1, p.a1 / p.va1],
      [CONFIG.candB, CONFIG.colours[1], p.b, p.b / p.v, p.b1, p.b1 / p.va1]
    ].sort((x, y) => y[2] - x[2]);
    const others = full ? [
      ["Blank",  null, p.bl2, p.bl2 / cast2, p.bl1, p.bl1 / cast1],
      ["Null",   null, p.nu2, p.nu2 / cast2, p.nu1, p.nu1 / cast1],
      ["Absent", null, p.ab2, p.ab2 / reg2,  p.ab1, p.ab1 / reg1]
    ] : [];

    const row = ([label, colour, votes, share, votes1, share1], cls) =>
      '<tr class="' + cls + '"><td>' + swatch(colour) + esc(label) + "</td>" +
      '<td class="vm-num">' + fmt.format(votes) + '</td><td class="vm-num">' + pct(share) + "</td>" +
      (first ? '<td class="vm-num vm-chg vm-chg1">(' + voteChange(votes - votes1) + "</td>" +
               '<td class="vm-num vm-chg">' + shareChange(share - share1) + ")</td>" : "") + "</tr>";

    const tie = candidates[0][2] === candidates[1][2];
    const rows = candidates.map((c, i) => row(c, i === 0 && !tie ? "vm-lead" : "")).join("") +
                 others.map((o, i) => row(o, i === 0 ? "vm-split" : "")).join("");
    const head = first
      ? '<thead><tr><th></th><th class="vm-num" colspan="2">Runoff</th><th class="vm-num vm-chg1" colspan="2">vs 1st round</th></tr></thead>'
      : "";

    const note = [fmt.format(p.n) + (p.n === 1 ? " section" : " sections")];
    if (full) note.push(fmt.format(reg2) + " registered voters");
    if (p.p > 1) note.push(p.p + " polling places share this point");
    if (full && !first) note.push("no first-round comparison: the sections changed between rounds");

    return '<div class="vm-pop">' +
      (p.l ? '<div class="vm-place">' + esc(p.l) + "</div>" : "") +
      (p.m ? '<div class="vm-muni">' + esc(p.m) + "</div>" : "") +
      "<table>" + head + "<tbody>" + rows + "</tbody></table>" +
      '<div class="vm-note">' + note.join(" · ") + "</div></div>";
  };

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, maxWidth: "360px" });
  const show = e => {
    const f = e.features && e.features[0];
    if (!f) return;
    popup.setMaxWidth(Math.min(360, map.getContainer().clientWidth - 16) + "px")   // fits on phones
      .setLngLat(f.geometry.coordinates).setHTML(popupHTML(f.properties)).addTo(map);
  };
  map.on("mousemove", "votes", e => { map.getCanvas().style.cursor = "pointer"; show(e); });
  map.on("mouseleave", "votes", () => { map.getCanvas().style.cursor = ""; popup.remove(); });
  map.on("click", "votes", show);
  map.on("click", e => {
    if (!map.queryRenderedFeatures(e.point, { layers: ["votes"] }).length) popup.remove();
  });

  // ---- Jump to a capital ------------------------------------------------------------------
  // "Brazil" first, then the 27 capitals in alphabetical order under one heading
  const jump = document.getElementById("vm-jump");
  const option = (text, value) => {
    const o = document.createElement("option");
    o.textContent = text;
    o.value = value;
    return o;
  };
  jump.appendChild(option("Brazil", "brazil"));
  const group = document.createElement("optgroup");
  group.label = "Capitals";
  CONFIG.capitals
    .map((c, i) => [c, i])
    .sort(([a], [b]) => a[0].localeCompare(b[0], "pt-BR"))
    .forEach(([[name, state], i]) => group.appendChild(option(name + " (" + state + ")", i)));
  jump.appendChild(group);

  jump.addEventListener("change", () => {
    popup.remove();
    if (jump.value === "brazil") {
      map.fitBounds(CONFIG.brazil, { padding: 20 });
    } else {
      const [, , lon, lat, zoom] = CONFIG.capitals[+jump.value];
      map.flyTo({ center: [lon, lat], zoom });
    }
  });
})();
