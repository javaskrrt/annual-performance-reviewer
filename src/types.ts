export type Commit = {
  repoName: string;
  repoPath: string;
  hash: string;
  authorName: string;
  authorEmail: string;
  dateISO: string;
  subject: string;
  body: string;
};

export type ReviewResponse = {
  didWell: string;
  improve: string;
  goals: string;
  raw?: any;
};
