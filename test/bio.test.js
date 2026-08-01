/* BioinfoGPT — unit tests for the bioinformatics toolkit (js/bio.js).
 * Run:  node test/bio.test.js   (no dependencies, plain Node >= 18)
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

console.log("— sequence detection —");
eq("DNA", B.detectType("ATGCGATCG"), "DNA");
eq("RNA", B.detectType("AUGCGAUCG"), "RNA");
eq("protein", B.detectType("MVLSPADKTNVKAAWG"), "protein");
eq("lowercase", B.detectType("atgc"), "DNA");
eq("whitespace/digits ignored", B.detectType("AT GC 123\nAT"), "DNA");
eq("empty", B.detectType("   "), "empty");
eq("FASTA header stripped", B.clean(">seq1\nATGC\nAT"), "ATGCAT");

console.log("— statistics —");
let st = B.stats("ATGC");
eq("length", st.length, 4);
eq("GC %", +st.gc.toFixed(2), 50);
eq("counts", st.counts, { A: 1, T: 1, G: 1, C: 1 });
st = B.stats("MVLSPA");
eq("protein length", st.length, 6);
eq("protein mw > 0", st.mw > 0, true);

console.log("— reverse complement —");
eq("DNA", B.reverseComplement("ATGC"), "GCAT");
eq("RNA keeps U", B.reverseComplement("AUG"), "CAU");
eq("mixed", B.reverseComplement("ATGCAUG"), "CATGCAT");
eq("ambiguous IUPAC", B.reverseComplement("ARY"), "RYT");

console.log("— translation —");
let t = B.translate("ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG", 0);
eq("aa string", t.sequence.slice(0, 5), "MAIVM");
eq("stop codons", t.stopCount, 2);
eq("frame 1", B.translate("ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG", 1).sequence.slice(0, 3), "WPL");
t = B.translate("ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG", 2);
eq("frame 2 starts", t.sequence[0], "G");

console.log("— alphabet validation —");
eq("valid protein", B.checkAlphabet("MVLSPADK").valid, true);
eq("protein invalid pos", B.checkAlphabet("MVLSPAZDK").invalid.map((i) => i.pos), [7]);
eq("ambiguous flagged", B.checkAlphabet("ATGCZ").valid, false);
eq("ambiguous type", B.checkAlphabet("ATGCZ").type, "ambiguous");

console.log("— GC sliding window —");
const w = B.gcWindow("GCGCGCGCGCGCGCGC", 8, 8);
eq("window gc 100%", +w[0].gc.toFixed(1), 100);

console.log("— random generators —");
eq("randomDNA length", B.randomDNA(100).length, 100);
eq("randomRNA length", B.randomRNA(80).length, 80);
eq("randomProtein length", B.randomProtein(50).length, 50);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
