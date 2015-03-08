require('angular');

angular.module('webApp').controller('blockchainController', ['$scope', '$rootScope', '$http', "userService", "$interval", 'blockService', 'blockModal', 'ngTableParams', function ($rootScope, $scope, $http, userService, $interval, blockService, blockModal, ngTableParams) {
	$scope.address = userService.address;
	$scope.loading = true;

	//Blocks
	$scope.tableBlocks = new ngTableParams({
		page: 1,
		count: 20
	}, {
		total: 0,
		counts: [],
		getData: function ($defer, params) {
			$scope.loading = true;
			blockService.getBlocks($defer, params, $scope.filter, function () {
				$scope.loading = false;
			});
		}
	});

	$scope.tableBlocks.settings().$scope = $scope;

	$scope.$watch("filter.$", function () {
		$scope.tableBlocks.reload();
	});

	$scope.updateBlocks = function () {
		$scope.tableBlocks.reload();
	};
	//end Blocks


	$scope.blocksInterval = $interval(function () {
		$scope.updateBlocks();
	}, 1000 * 60);

	$scope.$on('$destroy', function () {
		$interval.cancel($scope.blocksInterval);
		$scope.blocksInterval = null;
	});

	$scope.showBlock = function (block) {
		$scope.modal = blockModal.activate({block: block});
	}
}]);