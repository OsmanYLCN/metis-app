CREATE TABLE finance_budgets (
 project_ref TEXT NOT NULL,user_id TEXT NOT NULL,
 month TEXT NOT NULL CHECK(length(month)=7 AND month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
 category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 60),
 limit_cents INTEGER NOT NULL CHECK(limit_cents BETWEEN 1 AND 999999999999),
 PRIMARY KEY(project_ref,user_id,month,category)
);
