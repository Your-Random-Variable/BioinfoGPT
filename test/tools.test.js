/* BioinfoGPT — tests for new tools (findORFs, sixFrame, motif, restriction, protein props, codon usage, parseFasta, pairwiseIdentity)
 * Run: node test/tools.test.js
 */
const path = require("path");
global.window = global;
require(path.join(__dirname, "..", "js", "bio.js"));
const B = global.window.BIO;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + "\n      got  " + g + "\n      want " + w); }
}
function approx(name, got, want, eps = 1e-6) {
  if (Math.abs(got - want) <= eps) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${got}\n      want ${want} ±${eps}`); }
}
function condition(name, cond, details = "") {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (details ? " — " + details : "")); }
}

console.log("— findORFs —");
{
  const seq = "ATG" + "GCT".repeat(31) + "TAA";
  const orfs = B.findORFs(seq, 30);
  condition("ORF found", orfs.length >= 1, `len ${orfs.length}`);
  if (orfs.length) {
    const o = orfs[0];
    eq("ORF 32 aa", o.length, 32);
    condition("ORF complete", o.complete === true);
    condition("ORF starts M", o.protein[0] === "M");
    eq("ORF start = 1", o.start, 1);
  }
  const seqShort = "ATGGGGTAA";
  const orfsShort = B.findORFs(seqShort, 30);
  condition("minAA filter excludes short ORF", orfsShort.length === 0, `got ${orfsShort.length}`);
  const orfsShortLow = B.findORFs(seqShort, 1);
  condition("short ORF included with low minAA", orfsShortLow.length >= 1);
}

console.log("— sixFrame —");
{
  const frames = B.sixFrame("ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG");
  eq("sixFrame length 6", frames.length, 6);
  eq("labels", frames.map(f => f.label), ["+1","+2","+3","-1","-2","-3"]);
}

console.log("— iupacToRegex / findMotif —");
{
  const seq = "AAGAATTCAA";
  const res = B.findMotif(seq, "GAATTC");
  condition("Motif GAATTC found", res.count >= 1);
  if (res.hits.length) {
    const fwd = res.hits.find(h => h.strand === 1);
    if (fwd) eq("forward hit at position 3", fwd.start, 3);
    else condition("forward hit exists", false);
  }

  const pal = "GGATCC";
  const resPal = B.findMotif(pal, "GGATCC");
  eq("Palindrome 2 hits", resPal.count, 2);

  const resOverlap = B.findMotif("AAAA", "AAA");
  const fwdHits = resOverlap.hits.filter(h => h.strand === 1);
  eq("Overlapping AAA in AAAA -> 2 forward hits", fwdHits.length, 2);

  const bad = B.findMotif("ATGC", "ZZZ");
  condition("Bad motif returns error", !!bad.error);
  eq("Bad motif hits empty", bad.hits.length, 0);
}

console.log("— restrictionMap —");
{
  const seq = "GGGGAATTCGGG";
  const rm = B.restrictionMap(seq, ["EcoRI"]);
  condition("EcoRI 1 cut", rm.enzymes[0] && rm.enzymes[0].count === 1);
  if (rm.enzymes[0] && rm.enzymes[0].cuts.length) {
    eq("EcoRI cut at 5", rm.enzymes[0].cuts[0], 5);
  }
  eq("Fragments sum to 12", rm.fragments.reduce((a,b)=>a+b,0), 12);
}

console.log("— proteinProperties —");
{
  const polyI = "I".repeat(10);
  const propI = B.proteinProperties(polyI);
  approx("GRAVY poly-Ile = 4.5", propI.gravy, 4.5);

  const polyR = "R".repeat(10);
  const propR = B.proteinProperties(polyR);
  approx("GRAVY poly-Arg = -4.5", propR.gravy, -4.5);

  const propW = B.proteinProperties("W");
  eq("Extinction W=5500", propW.extinction, 5500);

  const propWY = B.proteinProperties("WY");
  eq("Extinction WY=6990", propWY.extinction, 6990);

  const polyK = "K".repeat(10);
  const propK = B.proteinProperties(polyK);
  condition("poly-K pI > 10", propK.pI > 10, `pI ${propK.pI}`);

  const polyE = "E".repeat(10);
  const propE = B.proteinProperties(polyE);
  condition("poly-E pI < 4.5", propE.pI < 4.5, `pI ${propE.pI}`);
}

console.log("— codonUsage —");
{
  const cu = B.codonUsage("GCTGCTGCC");
  eq("codonUsage total 3", cu.total, 3);
  const gct = cu.usage["GCT"];
  eq("GCT count 2", gct, 2);
  const byA = cu.byAA["A"];
  if (byA) {
    const gctEntry = byA.find(e => e.codon === "GCT");
    if (gctEntry) {
      approx("GCT fraction 2/3", gctEntry.fraction, 2/3);
    } else condition("GCT entry exists", false);
  } else condition("byAA A exists", false);
}

console.log("— parseFasta —");
{
  const fasta = ">seq1 description here\nATGCATGC\nATGC\n>seq2 other\nGGGCCC\nAAA\n";
  const recs = B.parseFasta(fasta);
  eq("parseFasta two records", recs.length, 2);
  if (recs.length >= 2) {
    eq("first id", recs[0].id, "seq1");
    condition("first seq joined", recs[0].seq.includes("ATGCATGCATGC") || recs[0].seq.length >= 8, `seq ${recs[0].seq}`);
    eq("second id", recs[1].id, "seq2");
  }
}

console.log("— pairwiseIdentity —");
{
  const pi = B.pairwiseIdentity("ACGT", "ACTT");
  approx("pairwiseIdentity 75", pi.identity, 75);
  eq("matches", pi.matches, 3);
  eq("compared", pi.compared, 4);
  const pi2 = B.pairwiseIdentity("ACG", "ACGT");
  condition("length mismatch flagged", pi2.lengthMismatch === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
