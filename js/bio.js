/* ============================================================
 *  BioinfoGPT — client-side bioinformatics toolkit
 *  Pure functions (no DOM), so they're unit-testable in Node.
 * ============================================================ */
window.BIO = (() => {
  const DNA_RE = /^[ACGTUNRYSWKMBDHV]+$/i;      // IUPAC DNA/RNA ambiguity codes
  const PROTEIN_RE = /^[ACDEFGHIKLMNPQRSTVWY\*X]+$/i;
  const STRIP = /[\s\d_\-]/g;                    // ignore whitespace / digits in input

  /* Standard genetic code: codon -> one-letter amino acid */
  const CODON_TABLE = {
    TTT: "F", TTC: "F", TTA: "L", TTG: "L",
    TCT: "S", TCC: "S", TCA: "S", TCG: "S",
    TAT: "Y", TAC: "Y", TAA: "*", TAG: "*",
    TGT: "C", TGC: "C", TGA: "*", TGG: "W",
    CTT: "L", CTC: "L", CTA: "L", CTG: "L",
    CCT: "P", CCC: "P", CCA: "P", CCG: "P",
    CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
    CGT: "R", CGC: "R", CGA: "R", CGG: "R",
    ATT: "I", ATC: "I", ATA: "I", ATG: "M",
    ACT: "T", ACC: "T", ACA: "T", ACG: "T",
    AAT: "N", AAC: "N", AAA: "K", AAG: "K",
    AGT: "S", AGC: "S", AGA: "R", AGG: "R",
    GTT: "V", GTC: "V", GTA: "V", GTG: "V",
    GCT: "A", GCC: "A", GCA: "A", GCG: "A",
    GAT: "D", GAC: "D", GAA: "E", GAG: "E",
    GGT: "G", GGC: "G", GGA: "G", GGG: "G",
  };

  const COMPLEMENT = {
    A: "T", T: "A", G: "C", C: "G", U: "A", N: "N",
    R: "Y", Y: "R", S: "S", W: "W", K: "M", M: "K",
    B: "V", V: "B", D: "H", H: "D",
  };

  /* ---------- detection ---------- */
  function clean(seq) {
    return String(seq || "")
      .split("\n")
      .filter((l) => !l.trim().startsWith(">")) // drop FASTA header lines
      .join("")
      .replace(STRIP, "")
      .toUpperCase();
  }

  function detectType(seq) {
    const s = clean(seq);
    if (!s) return "empty";
    if (/^[ACGTN]+$/i.test(s) || DNA_RE.test(s)) {
      // U present but no T -> RNA; otherwise DNA (T only) or mixed
      if (/U/.test(s) && !/T/.test(s)) return "RNA";
      if (/U/.test(s) && /T/.test(s)) return "DNA (contains U — check input)";
      return "DNA";
    }
    if (PROTEIN_RE.test(s)) return "protein";
    return "ambiguous";
  }

  /* ---------- statistics ---------- */
  function stats(seq) {
    const s = clean(seq);
    const counts = {};
    for (const ch of s) counts[ch] = (counts[ch] || 0) + 1;
    const gc = s ? ((counts.G || 0) + (counts.C || 0)) / s.length * 100 : 0;
    const at = s ? ((counts.A || 0) + (counts.T || 0) + (counts.U || 0)) / s.length * 100 : 0;
    // Approximate molecular weight (Da) of the single strand / peptide
    let mw = 0;
    for (const ch of s) {
      if (DNA_RE.test(ch)) mw += 330;            // ~330 Da per DNA residue
      else if (ch === "U") mw += 323;
      else mw += 110;                            // ~110 Da per amino acid residue
    }
    mw -= (s.length - 1) * 18.015;               // minus condensation water
    const tm = meltingTemp(s, counts);
    return { length: s.length, counts, gc, at, mw: Math.max(0, mw), tm, purines: (counts.A || 0) + (counts.G || 0), pyrimidines: (counts.C || 0) + (counts.T || 0) + (counts.U || 0) };
  }

  function meltingTemp(s, counts) {
    if (!s) return null;
    // Basic nearest-neighbor-free estimate for short oligos
    if (s.length <= 14) {
      return 2 * ((counts.A || 0) + (counts.T || 0) + (counts.U || 0)) + 4 * ((counts.G || 0) + (counts.C || 0));
    }
    const gc = ((counts.G || 0) + (counts.C || 0)) / s.length * 100;
    return 64.9 + 41 * (gc - 16.4) / s.length;   // °C, rough estimate
  }

  /* ---------- reverse complement ---------- */
  function reverseComplement(seq) {
    const s = clean(seq);
    const rna = /U/.test(s) && !/T/.test(s);
    const map = rna ? { ...COMPLEMENT, A: "U" } : COMPLEMENT; // RNA: A -> U
    return [...s].reverse().map((ch) => map[ch] || ch).join("");
  }

  function reverse(seq) { return clean(seq).split("").reverse().join(""); }

  /* ---------- translation ---------- */
  function translate(seq, frame = 0) {
    const s = clean(seq);
    const start = ((frame % 3) + 3) % 3;
    const codons = [];
    const aa = [];
    for (let i = start; i + 2 < s.length; i += 3) {
      const codon = s.slice(i, i + 3);
      codons.push(codon);
      aa.push(CODON_TABLE[codon] ?? "X");
    }
    return { codons, aa, sequence: aa.join(""), frame: start, stopCount: aa.filter((a) => a === "*").length };
  }

  /* ---------- alphabet validation ---------- */
  const VALID = {
    DNA: "ACGTN",
    RNA: "ACGUN",
    protein: "ACDEFGHIKLMNPQRSTVWYX*",
  };
  const IUPAC_EXTRA = "RYSWKMBDHV";

  function checkAlphabet(seq) {
    const s = clean(seq);
    const type = detectType(s);
    if (type === "empty") return { type, invalid: [], valid: true };
    const allowed = type === "protein"
      ? VALID.protein
      : type === "ambiguous"
        ? "ACGTUNRYSWKMBDHVACDEFGHIKLMNPQRSTVWYX*"
        : VALID[type] + IUPAC_EXTRA;
    const invalid = [];
    for (let i = 0; i < s.length; i++) {
      if (!allowed.includes(s[i])) invalid.push({ ch: s[i], pos: i + 1 });
    }
    return { type, invalid, valid: invalid.length === 0 };
  }

  /* ---------- random sequence generators ---------- */
  function randomDNA(n) {
    const alpha = "ACGT";
    return Array.from({ length: n }, () => alpha[Math.floor(Math.random() * 4)]).join("");
  }
  function randomRNA(n) {
    const alpha = "ACGU";
    return Array.from({ length: n }, () => alpha[Math.floor(Math.random() * 4)]).join("");
  }
  function randomProtein(n) {
    const alpha = "ACDEFGHIKLMNPQRSTVWY";
    return Array.from({ length: n }, () => alpha[Math.floor(Math.random() * 20)]).join("");
  }

  /* ---------- GC content + sliding window (for plots/labels) ---------- */
  function gcWindow(seq, win = 100, step = 50) {
    const s = clean(seq);
    const out = [];
    for (let i = 0; i + win <= s.length; i += step) {
      const w = s.slice(i, i + win);
      const g = (w.match(/[GC]/g) || []).length;
      out.push({ start: i, gc: g / win * 100 });
    }
    return out;
  }

  return {
    clean, detectType, stats, reverseComplement, reverse, translate,
    checkAlphabet, randomDNA, randomRNA, randomProtein, gcWindow, CODON_TABLE,
  };
})();
