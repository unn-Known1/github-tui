import https from 'https';

const GITHUB_API = 'api.github.com';

function makeRequest(path, token, method = 'GET') {
  return new Promise((resolve, reject) => {
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
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`GitHub API error: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

export async function getAuthenticatedUser(token) {
  try {
    const user = await makeRequest('/user', token);
    return user;
  } catch (error) {
    return null;
  }
}

export async function getUserRepositories(token, page = 1, perPage = 10) {
  try {
    const repos = await makeRequest(
      `/user/repos?page=${page}&per_page=${perPage}&sort=updated`,
      token
    );
    return repos;
  } catch (error) {
    return [];
  }
}

export async function getRepository(token, owner, repo) {
  try {
    const repoData = await makeRequest(`/repos/${owner}/${repo}`, token);
    return repoData;
  } catch (error) {
    return null;
  }
}

export async function getRepositoryIssues(token, owner, repo, page = 1, perPage = 10) {
  try {
    const issues = await makeRequest(
      `/repos/${owner}/${repo}/issues?page=${page}&per_page=${perPage}`,
      token
    );
    return issues;
  } catch (error) {
    return [];
  }
}

export async function getRepositoryPullRequests(token, owner, repo, page = 1, perPage = 10) {
  try {
    const prs = await makeRequest(
      `/repos/${owner}/${repo}/pulls?page=${page}&per_page=${perPage}`,
      token
    );
    return prs;
  } catch (error) {
    return [];
  }
}

export async function getNotifications(token) {
  try {
    const notifications = await makeRequest('/notifications', token);
    return notifications;
  } catch (error) {
    return [];
  }
}

export async function searchRepositories(token, query, page = 1, perPage = 10) {
  try {
    const results = await makeRequest(
      `/search/repositories?q=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`,
      token
    );
    return results.items || [];
  } catch (error) {
    return [];
  }
}

export async function getRepositoryDetails(token, owner, repo) {
  try {
    const repoData = await makeRequest(`/repos/${owner}/${repo}`, token);
    return repoData;
  } catch (error) {
    return null;
  }
}

export async function getRepositoryContributors(token, owner, repo, page = 1, perPage = 10) {
  try {
    const contributors = await makeRequest(
      `/repos/${owner}/${repo}/contributors?page=${page}&per_page=${perPage}`,
      token
    );
    return contributors;
  } catch (error) {
    return [];
  }
}

export async function getRepositoryLanguages(token, owner, repo) {
  try {
    const languages = await makeRequest(
      `/repos/${owner}/${repo}/languages`,
      token
    );
    return languages;
  } catch (error) {
    return {};
  }
}

export async function getRepositoryReleases(token, owner, repo, page = 1, perPage = 5) {
  try {
    const releases = await makeRequest(
      `/repos/${owner}/${repo}/releases?page=${page}&per_page=${perPage}`,
      token
    );
    return releases;
  } catch (error) {
    return [];
  }
}
