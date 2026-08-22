# Portal CTA contract

The portal CTA navigates to a category overview. It does not itself start the questionnaire.

- Portal hero/category cards use wording equivalent to “診断内容を見る”.
- The category `StartScreen` owns the actual “診断をはじめる” action.
- Direct category URLs keep showing the category overview before questions.
- No query parameter or browser-history contract is introduced for this change.
