import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '15m',
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<5000'],
  },
};

const baseUrl = __ENV.BASE_URL || 'http://localhost:8000';
const bearerToken = __ENV.BEARER_TOKEN || '';
const repoId = __ENV.REPO_ID || '';

function headers() {
  return {
    Authorization: `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
  };
}

export default function () {
  const knowledge = http.get(`${baseUrl}/api/knowledge/repositories/${repoId}/entries`, {
    headers: headers(),
  });
  check(knowledge, {
    'knowledge status is 200': (res) => res.status === 200,
  });

  const chat = http.post(
    `${baseUrl}/api/chat/query`,
    JSON.stringify({
      repo_id: repoId,
      query: 'Summarize the most recent architecture changes.',
      limit: 5,
    }),
    { headers: headers() }
  );
  check(chat, {
    'chat status is 200': (res) => res.status === 200,
  });

  sleep(1);
}
