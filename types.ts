export type Category = "positive" | "negative" | "edge";

export interface TestStep {
  action: string;
  expected: string;
}

export interface TestCase {
  title: string;
  category: Category;
  priority: 1 | 2 | 3 | 4;
  covers?: string[];
  preconditions?: string;
  test_data?: string;
  steps: TestStep[];
}

export interface TestSuite {
  summary: string;
  assumptions?: string[];
  open_questions?: string[];
  test_cases: TestCase[];
  warnings?: string[];
}

export interface Requirement {
  source: "azure" | "jira" | "file";
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  areaPath?: string;
  iterationPath?: string;
  apiUrl?: string; // REST url of the work item, used to link test cases back
}
