const { registerContainerReadRoutes } = require('./routes-containers-read');
const { registerContainerWriteRoutes } = require('./routes-containers-write');

const registerContainerRoutes = ({ app, ...deps }) => {
  registerContainerReadRoutes({ app, ...deps });
  registerContainerWriteRoutes({ app, ...deps });
};

module.exports = {
  registerContainerRoutes,
};
