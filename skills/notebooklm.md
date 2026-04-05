# NotebookLM Usage

## How to Formulate Queries

- Be specific: instead of "tell me about auth", ask "What authentication patterns does the architecture document recommend for service-to-service communication?"
- Reference source material explicitly: "Based on the arc42 document, ..."
- Ask one question per query -- compound questions get partial answers.
- Request structured output when useful: "List the quality requirements as a numbered list with rationale."

## When to Use NotebookLM vs Direct Research

| Use NotebookLM                                  | Use Direct Research                          |
|--------------------------------------------------|----------------------------------------------|
| Answering questions grounded in uploaded sources | Exploring topics not covered by your sources |
| Cross-referencing multiple project documents     | Searching for latest library versions / CVEs |
| Summarizing or synthesizing existing material    | Writing new code or generating test data     |
| Verifying claims against authoritative docs      | Debugging runtime errors                     |

- Default to NotebookLM when the answer likely exists in the project's own documentation.
- Fall back to direct research when NotebookLM cannot find a grounded answer.

## Interpreting Source-Grounded Answers

- Every NotebookLM answer should reference specific passages from uploaded sources.
- If an answer lacks source citations, treat it as unverified -- confirm independently.
- Compare the answer against the cited passage to ensure it was not paraphrased inaccurately.
- Flag any answer that contradicts other known project decisions for team review.

## Citation Handling

- Preserve the original source name and section when referencing NotebookLM output.
- Format citations as: `[Source: <document-name>, Section: <heading>]`.
- When incorporating NotebookLM findings into deliverables, include the citation inline.
- If multiple sources support a claim, list all of them -- do not cherry-pick.
- Periodically verify that uploaded sources are current; stale documents produce stale answers.
