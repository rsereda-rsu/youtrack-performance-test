import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

export const options = {
  stages: [
    { duration: '5m', target: 50 },
    { duration: '10m', target: 100 },
    { duration: '10m', target: 200 },
    { duration: '10m', target: 300 },
    { duration: '10m', target: 400 },
    { duration: '5m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<3000'],
  },
};

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '');
const AUTH_MODE = __ENV.AUTH_MODE || 'basic'; // basic | bearer
const BASIC_AUTH = __ENV.BASIC_AUTH || '';
const TOKEN = __ENV.TOKEN || '';

const SPACE_KEY = __ENV.SPACE_KEY || 'TEST';
const SEARCH_LIMIT = Number(__ENV.SEARCH_LIMIT || '20');
const UPDATE_MODE = __ENV.UPDATE_MODE || 'comment'; // comment | page-update
const PAGE_ID_PREFIX = __ENV.PAGE_ID_PREFIX || '';
const PAGE_ID_LIST = (__ENV.PAGE_ID_LIST || '').split(',').map(s => s.trim()).filter(Boolean);

const MIN_SLEEP = Number(__ENV.MIN_SLEEP || '1');
const MAX_SLEEP = Number(__ENV.MAX_SLEEP || '3');

const CQL = __ENV.CQL || `space="${SPACE_KEY}" order by lastmodified desc`;

function authHeaders(json = true) {
  const headers = {
    Accept: 'application/json',
  };

  if (json) {
    headers['Content-Type'] = 'application/json';
  }

  if (AUTH_MODE === 'basic') {
    headers['Authorization'] = `Basic ${BASIC_AUTH}`;
  } else {
    headers['Authorization'] = `Bearer ${TOKEN}`;
  }

  return { headers };
}

function randomPageId() {
  if (PAGE_ID_LIST.length > 0) {
    return PAGE_ID_LIST[Math.floor(Math.random() * PAGE_ID_LIST.length)];
  }
  return PAGE_ID_PREFIX;
}

function searchContent() {
  const cql = encodeURIComponent(CQL);
  const url = `${BASE_URL}/rest/api/content/search?cql=${cql}&limit=${SEARCH_LIMIT}&expand=version`;

  const res = http.get(url, authHeaders(false));

  check(res, {
    'search status 200': (r) => r.status === 200,
    'search has results array': (r) => {
      try {
        const body = r.json();
        return Array.isArray(body.results);
      } catch (_) {
        return false;
      }
    },
  });

  return res;
}

function getPage(pageId) {
  const url = `${BASE_URL}/rest/api/content/${pageId}?expand=body.storage,version,space`;

  const res = http.get(url, authHeaders(false));

  check(res, {
    'get page status 200': (r) => r.status === 200,
  });

  return res;
}

function addComment(pageId) {
  const url = `${BASE_URL}/rest/api/content`;

  const payload = JSON.stringify({
    type: 'comment',
    container: {
      id: pageId,
      type: 'page',
    },
    body: {
      storage: {
        value: `<p>k6 perf test comment vu=${exec.vu.idInTest} iter=${exec.scenario.iterationInTest}</p>`,
        representation: 'storage',
      },
    },
  });

  const res = http.post(url, payload, authHeaders(true));

  check(res, {
    'comment create status 200/201': (r) => r.status === 200 || r.status === 201,
  });

  return res;
}

function updatePage(pageId) {
  const getRes = getPage(pageId);

  let page;
  try {
    page = getRes.json();
  } catch (_) {
    return getRes;
  }

  const currentVersion = page?.version?.number;
  const title = page?.title;
  const spaceKey = page?.space?.key;

  if (!currentVersion || !title || !spaceKey) {
    return getRes;
  }

  const url = `${BASE_URL}/rest/api/content/${pageId}`;
  const payload = JSON.stringify({
    id: pageId,
    type: 'page',
    title: title,
    space: {
      key: spaceKey,
    },
    version: {
      number: currentVersion + 1,
    },
    body: {
      storage: {
        value: `<p>k6 perf test update vu=${exec.vu.idInTest} iter=${exec.scenario.iterationInTest}</p>`,
        representation: 'storage',
      },
    },
  });

  const res = http.put(url, payload, authHeaders(true));

  check(res, {
    'page update status 200': (r) => r.status === 200,
  });

  return res;
}

export default function () {
  if (!BASE_URL) {
    throw new Error('BASE_URL is required');
  }

  if (AUTH_MODE === 'basic' && !BASIC_AUTH) {
    throw new Error('BASIC_AUTH is required when AUTH_MODE=basic');
  }

  if (AUTH_MODE === 'bearer' && !TOKEN) {
    throw new Error('TOKEN is required when AUTH_MODE=bearer');
  }

  const pick = Math.random();

  // 80% search/read, 20% update
  if (pick < 0.8) {
    const searchRes = searchContent();

    let results = [];
    try {
      const body = searchRes.json();
      results = body.results || [];
    } catch (_) {
      results = [];
    }

    if (results.length > 0) {
      const page = results[Math.floor(Math.random() * results.length)];
      if (page && page.id) {
        getPage(page.id);
      }
    }
  } else {
    const pageId = randomPageId();

    if (!pageId) {
      throw new Error('Set PAGE_ID_LIST or PAGE_ID_PREFIX for update operations');
    }

    if (UPDATE_MODE === 'page-update') {
      updatePage(pageId);
    } else {
      addComment(pageId);
    }
  }

  sleep(Math.random() * (MAX_SLEEP - MIN_SLEEP) + MIN_SLEEP);
}