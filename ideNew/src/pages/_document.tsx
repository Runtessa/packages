import Document, { Html, Head, Main, NextScript } from "next/document";

class MyDocument extends Document {
  render() {
    return (
      <Html dir="ltr" lang="en">
        <Head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link rel="icon" href="/images/lm.png" />
        </Head>
        <body className="bg-bgApp text-textPrimary">
          <Main />
          <NextScript />
          <script src="babel/bable.js"></script>
        </body>
      </Html>
    );
  }
}

export default MyDocument;
