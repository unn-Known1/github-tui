import https from 'https';

const GITHUB_API = 'api.github.com';

function makeRequest(path, token, method = 'GET', timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new Error('Request timed out'));
      }
    }, timeoutMs);

    const options = {
      hostname: GITHUB_API,
      path,
      method,
      headers: {
        'User-Agent': 'GitHub-TUI',
        'Accept': 'application/vnd.github.v3+json',
        ...(token && { 'Authorization': `token ${token}` }),
      },
    };

    const req = https.request(options, (res) => {
      const rateRemaining = res.headers['x-ratelimit-remaining'];
      const rateReset = res.headers['x-ratelimit-reset'];

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (res.statusCode === 403 && rateRemaining === '0') {
          const resetDate = new Date(parseInt(rateReset) * 1000);
          reject(new Error(`Rate limited. Try again at ${resetDate.toLocaleTimeString()}`));
          return;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid JSON response'));
          }
        } else {
          let msg = `GitHub API error: ${res.statusCode}`;
          try {
            const body = JSON.parse(data);
            if (body.message) msg += ` - ${body.message}`;
          } catch {}
          reject(new Error(msg));
        }
      });
    });

    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    req.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('Connection closed'));
      }
    });

    req.end();
  });
}

export async function getAuthenticatedUser(token) {
  return makeRequest('/user', token);
}

export async function getUserRepositories(token, page = 1, perPage = 50) {
  return makeRequest(
    `/user/repos?page=${page}&per_page=${perPage}&sort=updated`,
    token
  );
}

export async function searchRepositories(token, query, page = 1, perPage = 10) {
  const results = await makeRequest(
    `/search/repositories?q=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`,
    token
  );
  return results.items || [];
}

export async function getRepositoryDetails(token, owner, repo) {
  return makeRequest(`/repos/${owner}/${repo}`, token);
}

export async function getRepositoryForks(token, owner, repo, page = 1, perPage = 30) {
  return makeRequest(
    `/repos/${owner}/${repo}/forks?page=${page}&per_page=${perPage}&sort=stargazers`,
    token
  );
}

export async function getCompare(token, owner, repo, base, head) {
  return makeRequest(
    `/repos/${owner}/${repo}/compare/${base}...${head}`,
    token
  );
}

export async function getRepositoryIssues(token, owner, repo, page = 1, perPage = 10) {
  return makeRequest(
    `/repos/${owner}/${repo}/issues?page=${page}&per_page=${perPage}`,
    token
  );
}

export async function getRepositoryPullRequests(token, owner, repo, page = 1, perPage = 10) {
  return makeRequest(
    `/repos/${owner}/${repo}/pulls?page=${page}&per_page=${perPage}`,
    token
  );
}

export async function getRepositoryContributors(token, owner, repo, page = 1, perPage = 10) {
  return makeRequest(
    `/repos/${owner}/${repo}/contributors?page=${page}&per_page=${perPage}`,
    token
  );
}

export async function getRepositoryLanguages(token, owner, repo) {
  return makeRequest(`/repos/${owner}/${repo}/languages`, token);
}

export async function getRepositoryReleases(token, owner, repo, page = 1, perPage = 5) {
  return makeRequest(
    `/repos/${owner}/${repo}/releases?page=${page}&per_page=${perPage}`,
    token
  );
}

export async function getNotifications(token) {
  return makeRequest('/notifications', token);
}
