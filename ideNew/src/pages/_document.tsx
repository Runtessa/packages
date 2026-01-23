import Document, { Html, Head, Main, NextScript } from "next/document";

class MyDocument extends Document {
  render() {
    return (
      <html dir="ltr" lang="en">
        <Head>
          <title>ADA Idp Control Panel</title>
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
        </body>
      </html>
    );
  }
}

export default MyDocument;
