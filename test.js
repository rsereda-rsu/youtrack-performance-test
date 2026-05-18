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

const BASE_URL = __ENV.BASE_URL;
const TOKEN = __ENV.YOUTRACK_TOKEN;
const PROJECT = __ENV.YOUTRACK_PROJECT || 'DEMO';
const SEARCH_TOP = __ENV.SEARCH_TOP || '20';
const UPDATE_MODE = __ENV.UPDATE_MODE || 'comment'; // comment | command
const ISSUE_ID_PREFIX = __ENV.ISSUE_ID_PREFIX || 'DEMO';
const UPDATE_ISSUE_COUNT = Number(__ENV.UPDATE_ISSUE_COUNT || '200');

function headers(json = true) {
  const h = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/json',
  };
  if (json) {
    h['Content-Type'] = 'application/json';
  }
  return { headers: h };
}

function randomIssueReadableId() {
  const n = (exec.vu.idInTest % UPDATE_ISSUE_COUNT) + 1;
  return `${ISSUE_ID_PREFIX}-${n}`;
}

function searchIssues() {
  const query = encodeURIComponent(`project: ${PROJECT} sort by: updated desc`);
  const fields = encodeURIComponent('id,idReadable,summary,updated');
  const url = `${BASE_URL}/api/issues?query=${query}&$top=${SEARCH_TOP}&fields=${fields}`;

  const res = http.get(url, headers(false));

  check(res, {
    'search status 200': (r) => r.status === 200,
    'search response is array': (r) => {
      try {
        return Array.isArray(r.json());
      } catch (_) {
        return false;
      }
    },
  });

  return res;
}

function getIssue(issueIdReadable) {
  const fields = encodeURIComponent('id,idReadable,summary,description,updated');
  const url = `${BASE_URL}/api/issues/${issueIdReadable}?fields=${fields}`;

  const res = http.get(url, headers(false));

  check(res, {
    'get issue status 200': (r) => r.status === 200,
  });

  return res;
}

function addComment(issueIdReadable) {
  const url = `${BASE_URL}/api/issues/${issueIdReadable}/comments?fields=id,text,created`;
  const body = JSON.stringify({
    text: `k6 perf test comment vu=${exec.vu.idInTest} iter=${exec.scenario.iterationInTest}`,
  });

  const res = http.post(url, body, headers(true));

  check(res, {
    'comment create status 200/201': (r) => r.status === 200 || r.status === 201,
  });

  return res;
}

function applyCommand(issueIdReadable) {
  const url = `${BASE_URL}/api/commands?fields=id`;
  const body = JSON.stringify({
    query: 'State Open',
    issues: [{ idReadable: issueIdReadable }],
  });

  const res = http.post(url, body, headers(true));

  check(res, {
    'command status 200/201': (r) => r.status === 200 || r.status === 201,
  });

  return res;
}

export default function () {
  if (!BASE_URL || !TOKEN) {
    throw new Error('BASE_URL and YOUTRACK_TOKEN environment variables are required');
  }

  const pick = Math.random();

  // 80% search flow, 20% update flow
  if (pick < 0.8) {
    const searchRes = searchIssues();

    let issues = [];
    try {
      issues = searchRes.json();
    } catch (_) {
      issues = [];
    }

    if (issues.length > 0) {
      const issue = issues[Math.floor(Math.random() * issues.length)];
      if (issue && issue.idReadable) {
        getIssue(issue.idReadable);
      }
    }
  } else {
    const issueIdReadable = randomIssueReadableId();

    getIssue(issueIdReadable);

    if (UPDATE_MODE === 'command') {
      applyCommand(issueIdReadable);
    } else {
      addComment(issueIdReadable);
    }
  }

  sleep(Math.random() * 2 + 1);
}