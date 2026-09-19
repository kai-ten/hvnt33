// Minimal reproductions of each engine's result markup (structure as observed
// in September 2026). Live layouts drift; the generic fallback covers gaps.
const bingWrap = (url: string) => "https://www.bing.com/ck/a?!&&p=abc&u=a1" + Buffer.from(url).toString("base64url") + "&ntb=1";

export const pages: Record<string, { url: string; html: string; expect: { url: string; title: string; snippet: string }[] }> = {
  google: {
    url: "https://www.google.com/search?q=harbor+works",
    html: `<div id="search"><div id="rso">
      <div class="MjjYud"><div class="g"><a jsname="UWckNb" href="https://city.gov/award"><h3>City award notice</h3></a><div class="VwiC3b">The council awarded the contract on June 12.</div></div></div>
      <div class="MjjYud"><div class="g"><a jsname="UWckNb" href="/url?q=https://news.example.com/harbor&sa=U"><h3>Harbor Works wins bid</h3></a><div class="VwiC3b">Local paper reports the award.</div></div></div>
      <div class="MjjYud"><a href="https://www.google.com/search?q=related"><h3>Related searches</h3></a></div>
    </div></div>`,
    expect: [
      { url: "https://city.gov/award", title: "City award notice", snippet: "The council awarded the contract on June 12." },
      { url: "https://news.example.com/harbor", title: "Harbor Works wins bid", snippet: "Local paper reports the award." },
    ],
  },
  google2026: {
    url: "https://www.google.com/search?q=henry+kravis&hl=en",
    // September 2026: result links are opaque /goto redirects; only the cite breadcrumb shows the destination.
    html: `<div id="search"><div id="rso">
      <div class="MjjYud"><div class="yuRUbf"><a jsname="UWckNb" href="/goto?url=CAESYgHrOz1"><h3>Henry Kravis - Wikipedia</h3><cite role="text">https://en.wikipedia.org › wiki › Henry_Kravis</cite></a></div><div class="VwiC3b">American billionaire businessman.</div></div>
      <div class="MjjYud"><div class="yuRUbf"><a jsname="UWckNb" href="/goto?url=CAESaQHrOz2"><h3>Conversation with Henry Kravis</h3><cite>https://events.business.columbia.edu › event › conversat...</cite></a></div><div class="VwiC3b">Columbia event.</div></div>
      <div class="MjjYud"><div class="yuRUbf"><a jsname="UWckNb" href="/goto?url=CAESZAHrOz3"><h3>Henry Kravis - KKR | LinkedIn</h3><cite>24.5K+ followers</cite></a></div><div class="VwiC3b">Founding Partner.</div></div>
    </div></div>`,
    expect: [
      { url: "https://en.wikipedia.org/wiki/Henry_Kravis", title: "Henry Kravis - Wikipedia", snippet: "American billionaire businessman." },
      { url: "https://events.business.columbia.edu/event/conversat", title: "Conversation with Henry Kravis", snippet: "Columbia event." },
      { url: "https://www.google.com/goto?url=CAESZAHrOz3", title: "Henry Kravis - KKR | LinkedIn", snippet: "Founding Partner." },
    ],
  },
  bing: {
    url: "https://www.bing.com/search?q=harbor+works",
    html: `<ol id="b_results">
      <li class="b_algo"><h2><a href="${bingWrap("https://city.gov/award")}">City award notice</a></h2><div class="b_caption"><p>The council awarded the contract.</p></div></li>
      <li class="b_algo"><h2><a href="https://registry.example.org/harbor-works">Harbor Works Ltd — registry</a></h2><div class="b_caption"><p class="b_lineclamp2">Company number 0123.</p></div></li>
      <li class="b_ad"><h2><a href="https://ads.example.com">Ad</a></h2></li>
    </ol>`,
    expect: [
      { url: "https://city.gov/award", title: "City award notice", snippet: "The council awarded the contract." },
      { url: "https://registry.example.org/harbor-works", title: "Harbor Works Ltd — registry", snippet: "Company number 0123." },
    ],
  },
  duckduckgo: {
    url: "https://duckduckgo.com/?q=harbor+works&ia=web",
    html: `<ol class="react-results--main">
      <li><article data-testid="result"><h2><a data-testid="result-title-a" href="https://city.gov/award"><span>City award notice</span></a></h2><div data-result="snippet"><span>Awarded June 12.</span></div></article></li>
      <li><article data-testid="result"><h2><a data-testid="result-title-a" href="https://duckduckgo.com/l/?uddg=${encodeURIComponent("https://archive.example.org/x?y=1")}">Archived copy</a></h2><div data-result="snippet">Snapshot.</div></article></li>
    </ol>`,
    expect: [
      { url: "https://city.gov/award", title: "City award notice", snippet: "Awarded June 12." },
      { url: "https://archive.example.org/x?y=1", title: "Archived copy", snippet: "Snapshot." },
    ],
  },
  brave: {
    url: "https://search.brave.com/search?q=harbor+works",
    // 2026 layout: web snippets are no longer inside #results; "cluster" blocks hold sub-links.
    html: `<main><div class="snippet" data-type="web"><a href="https://city.gov/award"><div class="title">City award notice</div></a><div class="snippet-description">Council minutes.</div></div><div class="snippet" data-type="cluster"><a href="https://city.gov/other"><div class="title">Other</div></a></div></main>`,
    expect: [{ url: "https://city.gov/award", title: "City award notice", snippet: "Council minutes." }],
  },
  mojeek: {
    url: "https://www.mojeek.com/search?q=harbor+works",
    html: `<ul class="results-standard"><li><a class="title" href="https://city.gov/award">City award notice</a><p class="s">Minutes.</p></li></ul>`,
    expect: [{ url: "https://city.gov/award", title: "City award notice", snippet: "Minutes." }],
  },
  startpage: {
    url: "https://www.startpage.com/do/search?q=harbor+works",
    html: `<div class="w-gl"><div class="result"><a class="result-title" href="https://city.gov/award"><h2>City award notice</h2></a><p class="description">Minutes.</p></div></div>`,
    expect: [{ url: "https://city.gov/award", title: "City award notice", snippet: "Minutes." }],
  },
  yandex: {
    url: "https://yandex.com/search/?text=harbor+works",
    html: `<ul><li class="serp-item"><a class="OrganicTitle-Link" href="https://city.gov/award"><h2>City award notice</h2></a><span class="OrganicTextContentSpan">Minutes.</span></li></ul>`,
    expect: [{ url: "https://city.gov/award", title: "City award notice", snippet: "Minutes." }],
  },
  unknown: {
    url: "https://search.example.net/?q=harbor",
    html: `<main><div class="hit"><a href="https://city.gov/award"><h3>City award notice</h3></a> Minutes of the meeting.</div><a href="https://search.example.net/next"><h3>Next page</h3></a></main>`,
    expect: [{ url: "https://city.gov/award", title: "City award notice", snippet: "Minutes of the meeting." }],
  },
};
