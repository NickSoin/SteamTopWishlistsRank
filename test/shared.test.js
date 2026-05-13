const assert = require("node:assert/strict");
const shared = require("../src/shared.js");

function runEstimateTests() {
  const cases = [
    [1, "4m+"],
    [2, "1.5m+"],
    [10, "1.5m+"],
    [11, "600k+"],
    [50, "600k+"],
    [51, "300k+"],
    [100, "300k+"],
    [101, "200k+"],
    [200, "200k+"],
    [201, "80k+"],
    [500, "80k+"],
    [501, "40k+"],
    [1000, "40k+"],
    [1001, "25k+"],
    [1500, "25k+"],
    [1501, "15k+"],
    [2000, "15k+"],
    [2001, "7k+"],
    [3000, "7k+"],
    [3001, "<7k"],
    [4616, "<7k"]
  ];

  for (const [rank, expected] of cases) {
    assert.equal(shared.estimateWishlists(rank), expected, `rank ${rank}`);
  }
}

function runParserTests() {
  const html = `
    <table>
      <tbody>
        <tr data-appid="1962700">
          <td class="dt-type-numeric">1.</td>
          <td>
            <a href="/app/1962700/"></a>
            <a href="/app/1962700/Subnautica_2/">Subnautica 2</a>
          </td>
          <td>115,00zl</td>
        </tr>
        <tr>
          <td>101.</td>
          <td><a href="https://steamdb.info/app/1234567/">Example &amp; Game</a></td>
        </tr>
      </tbody>
    </table>
  `;

  const entries = shared.parseRankingsFromSteamDbHtml(html);

  assert.equal(entries["1962700"].rank, 1);
  assert.equal(entries["1962700"].estimate, "4m+");
  assert.equal(entries["1962700"].name, "Subnautica 2");
  assert.equal(entries["1234567"].rank, 101);
  assert.equal(entries["1234567"].estimate, "200k+");
  assert.equal(entries["1234567"].name, "Example & Game");
}

function runFallbackParserTests() {
  const html = `
    <a href="/app/111/">Game One</a>
    <a href="/app/111/">Game One duplicate</a>
    <a href="/app/222/">Game Two</a>
  `;

  const entries = shared.parseRankingsFromSteamDbHtml(html);

  assert.equal(entries["111"].rank, 1);
  assert.equal(entries["222"].rank, 2);
}

function runSteamSearchParserTests() {
  const html = `
    <a href="https://store.steampowered.com/app/1962700/Subnautica_2/"
       data-ds-appid="1962700"
       class="search_result_row ds_collapse_flag">
      <span class="title">Subnautica 2</span>
    </a>
    <a href="https://store.steampowered.com/app/1422450/Deadlock/"
       data-ds-appid="1422450"
       class="search_result_row">
      <span class="title">Deadlock</span>
    </a>
  `;

  const entries = shared.parseRankingsFromSteamSearchHtml(html, 100);

  assert.equal(entries["1962700"].rank, 101);
  assert.equal(entries["1962700"].estimate, "200k+");
  assert.equal(entries["1962700"].name, "Subnautica 2");
  assert.equal(entries["1422450"].rank, 102);
}

runEstimateTests();
runParserTests();
runFallbackParserTests();
runSteamSearchParserTests();

console.log("All tests passed");
