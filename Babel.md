<script src="bable.js"></script>
    <script defer>
      function compileCode(sourceCode) {
        // Use Babel to transform the code
        const transformed = window.Babel.transform(sourceCode, {
          presets: [
            "es2015",
            "react",
            [
              "env",
              {
                useBuiltIns: "entry",
                corejs: 3,
              },
            ],
            // 'babili'
          ],
        });

        return transformed.code;
      }
      var code = `
import react from "react";
export const App=() =>{
  return <h1>Hello</h1>;
};


`;
      console.log(compileCode(code));
    </script>